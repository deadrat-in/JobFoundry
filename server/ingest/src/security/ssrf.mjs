/**
 * Connection-time SSRF guard for outbound LLM requests.
 *
 * BYOK lets users supply arbitrary api_base hostnames, so the static provider
 * allowlist is no longer viable. Instead we block any destination that resolves
 * to a private / loopback / link-local / reserved IP. Operator-trusted internal
 * gateways (see getTrustedApiBaseOrigins) are exempt so self-hosted deployments
 * (local Ollama on :11434) keep working.
 *
 * Three layers, applied per request:
 *   1. assertSafeOutboundUrl() validates scheme/credentials/trusted-origin and
 *      resolves the hostname against the blocked IP ranges before we send.
 *   2. safeFetch() follows redirects manually — every Location hop is re-validated
 *      before the next request, so a public endpoint can never bounce us into a
 *      private destination (or leak a bearer token there).
 *   3. Requests go through an undici Agent whose custom DNS lookup re-resolves and
 *      re-checks the non-public IP ranges at connect time, so the address actually
 *      connected to is the address we validated (closing the DNS-rebinding window).
 */

import { lookup as resolveHostname } from 'node:dns/promises';
import { isIP } from 'node:net';
import { fetch as undiciFetch, Agent } from 'undici';
import { getTrustedApiBaseOrigins } from '../settings/settings.mjs';

// IPv4 CIDR blocks that must never be reached over the public internet.
const BLOCKED_V4 = [
  [0, 0, 0, 0, 8], // "this network" / unspecified
  [10, 0, 0, 0, 8], // RFC 1918
  [100, 64, 0, 0, 10], // CGNAT
  [127, 0, 0, 0, 8], // loopback
  [169, 254, 0, 0, 16], // link-local (cloud metadata)
  [172, 16, 0, 0, 12], // RFC 1918
  [192, 0, 0, 0, 24], // IETF protocol assignments
  [192, 0, 2, 0, 24], // TEST-NET-1
  [192, 168, 0, 0, 16], // RFC 1918
  [198, 18, 0, 0, 15], // benchmarking
  [198, 51, 100, 0, 24], // TEST-NET-2
  [203, 0, 113, 0, 24], // TEST-NET-3
  [224, 0, 0, 0, 4], // multicast
  [240, 0, 0, 0, 4], // reserved
  [255, 255, 255, 255, 32], // limited broadcast
];

const BLOCKED_V6_PREFIXES = [
  // [prefix bytes (as hex string), prefix length]
  ['00000000000000000000000000000000', 128], // :: (unspecified)
  ['00000000000000000000000000000001', 128], // ::1 (loopback)
  ['000000000000000000000000', 96], // ::/96 (IPv4-compatible, e.g. ::192.168.1.1)
  ['fc000000000000000000000000000000', 7], // fc00::/7 (ULA)
  ['fe800000000000000000000000000000', 10], // fe80::/10 (link-local)
  ['ff000000000000000000000000000000', 8], // ff00::/8 (multicast)
  ['20010db8000000000000000000000000', 32], // 2001:db8::/32 (documentation)
];

const V4_MAPPED_PREFIX = '00000000000000000000ffff';

const MAX_REDIRECTS = 5;

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) | Number(octet), 0) >>> 0;
}

function cidr4ToMask(prefix) {
  return prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
}

function isBlockedV4(ip) {
  const int = ipv4ToInt(ip);
  for (const [a, b, c, d, prefix] of BLOCKED_V4) {
    const base = ipv4ToInt(`${a}.${b}.${c}.${d}`);
    const mask = cidr4ToMask(prefix);
    if ((int & mask) === (base & mask)) return true;
  }
  return false;
}

function ipv6ToBytes(addr) {
  const groupToHex = (group) => {
    if (group.includes('.')) {
      // IPv4 literal in mixed notation, e.g. "::ffff:127.0.0.1" → ffff:7f00:0001
      return group
        .split('.')
        .map((o) => Number(o).toString(16).padStart(2, '0'))
        .join('');
    }
    return group.padStart(4, '0');
  };

  // A dotted IPv4 group spans TWO 16-bit groups; count them as such so the
  // '::' expansion produces a true 16-byte address.
  const slotCount = (raw) =>
    raw
      .split(':')
      .filter(Boolean)
      .reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0);

  const [left, right] = addr.includes('::') ? addr.split('::') : [addr, ''];
  const leftGroups = left ? left.split(':').filter(Boolean) : [];
  const rightGroups = right ? right.split(':').filter(Boolean) : [];
  const missing = 8 - slotCount(left) - slotCount(right);
  if (missing < 0) return Buffer.alloc(0);
  const all = [...leftGroups, ...Array(missing).fill('0'), ...rightGroups];
  return Buffer.from(all.map(groupToHex).join(''), 'hex');
}

function matchesV6Prefix(bytes, prefixHex, prefixLen) {
  const prefixBytes = Buffer.from(prefixHex, 'hex');
  const byteLen = Math.floor(prefixLen / 8);
  const bitRemainder = prefixLen % 8;
  for (let i = 0; i < byteLen; i++) {
    if (bytes[i] !== prefixBytes[i]) return false;
  }
  if (bitRemainder > 0) {
    const mask = 0xff << (8 - bitRemainder);
    if ((bytes[byteLen] & mask) !== (prefixBytes[byteLen] & mask)) return false;
  }
  return true;
}

function isBlockedV6(addr) {
  const bytes = ipv6ToBytes(addr);
  if (bytes.length !== 16) return false;

  // IPv4-mapped IPv6 addresses (::ffff:1.2.3.4) inherit IPv4 policy before the
  // ::/96 check so public mapped addresses (::ffff:8.8.8.8) stay allowed.
  if (bytes.subarray(0, 12).toString('hex') === V4_MAPPED_PREFIX) {
    const v4 = Array.from(bytes.subarray(12)).join('.');
    return isBlockedV4(v4);
  }

  for (const [prefixHex, prefixLen] of BLOCKED_V6_PREFIXES) {
    if (matchesV6Prefix(bytes, prefixHex, prefixLen)) return true;
  }
  return false;
}

/**
 * True when the IP (v4 or v6) falls in a forbidden range.
 */
export function isBlockedIp(ip) {
  const family = isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) return isBlockedV6(ip);
  return true; // unresolvable garbage is treated as blocked
}

/**
 * Validates that an outbound target URL is safe to connect to.
 * - Rejects non-http(s) schemes and embedded credentials (structural).
 * - Requires https for non-trusted origins so API keys are never sent to public
 *   http endpoints; http is only allowed for operator-trusted gateways.
 * - Exempts operator-trusted origins (ALLOWED_LLM_BASES + local gateways).
 * - Resolves the hostname and blocks private/loopback/link-local/reserved IPs.
 *
 * @param {string} rawUrl - Target URL to validate.
 * @param {object} [env=process.env] - Environment configuration map.
 * @param {object} [options] - Validation options.
 * @param {boolean} [options.requireHttps=true] - Whether HTTPS is required for non-trusted targets.
 * @returns {Promise<void>} Resolves when the target is permitted, throws otherwise.
 */
export async function assertSafeOutboundUrl(
  rawUrl,
  env = process.env,
  { requireHttps = true } = {}
) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('Empty URL');
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: "${rawUrl}"`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`URL must use http or https scheme, got "${parsed.protocol}"`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL must not contain credentials (user:pass@host)');
  }

  const trusted = getTrustedApiBaseOrigins(env);
  if (trusted.has(parsed.origin)) {
    return; // operator-configured internal gateway
  }

  if (requireHttps && parsed.protocol === 'http:') {
    throw new Error(
      'http:// api_base is only allowed for operator-trusted internal gateways; ' +
        'use https:// for public endpoints (or add the origin to ALLOWED_LLM_BASES)'
    );
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error(`Connection to private/blocked IP is not allowed: ${hostname}`);
    }
    return;
  }

  let addresses;
  try {
    const res = await resolveHostname(hostname, { all: true, family: 0, verbatim: true });
    addresses = Array.isArray(res) ? res : [{ address: res.address }];
  } catch {
    throw new Error(`Unable to resolve host: ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new Error(`Unable to resolve host: ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new Error(
        `Connection to ${hostname} is blocked: it resolves to non-public IP ${address}`
      );
    }
  }
}

/**
 * Hostnames whose connections must be exempt from the non-public IP block
 * (trusted internal gateways from the operator's configuration).
 */
function trustedHostnames(env) {
  const hosts = new Set();
  for (const origin of getTrustedApiBaseOrigins(env)) {
    try {
      hosts.add(new URL(origin).hostname);
    } catch {
      // ignore malformed origin
    }
  }
  return hosts;
}

// Rebuild the pinned Agent only when the trusted-host set changes (tests rotate
// local servers; production config is static).
let pinnedAgent = null;
let pinnedAgentKey = '';

/**
 * An undici Agent that re-resolves and re-validates the destination at connect
 * time via a custom DNS lookup, binding the connection to the validated address.
 */
function getPinnedAgent(env = process.env) {
  const hosts = trustedHostnames(env);
  const key = [...hosts].sort().join(',');
  if (pinnedAgent && pinnedAgentKey === key) {
    return pinnedAgent;
  }

  pinnedAgent = new Agent({
    headersTimeout: 1_800_000,
    bodyTimeout: 1_800_000,
    connectTimeout: 60_000,
    connect: {
      lookup(hostname, _options, callback) {
        resolveHostname(hostname, { all: true, family: 0, verbatim: true })
          .then((records) => {
            const list = Array.isArray(records) ? records : [{ address: records.address }];

            if (!hosts.has(hostname)) {
              for (const { address } of list) {
                if (isBlockedIp(address)) {
                  const err = new Error(
                    `Connection to ${hostname} is blocked: resolves to non-public IP ${address}`
                  );
                  err.code = 'ERR_SSRF_BLOCKED';
                  throw err;
                }
              }
            }

            const { address, family } = list[0];
            callback(null, { address, family });
          })
          .catch((err) => callback(err));
      },
    },
  });
  pinnedAgentKey = key;
  return pinnedAgent;
}

const CREDENTIAL_HEADERS = ['authorization', 'proxy-authorization', 'cookie', 'cookie2'];

function withoutCredentialHeaders(headers) {
  const filtered = new Headers(headers ?? {});
  for (const name of CREDENTIAL_HEADERS) {
    filtered.delete(name);
  }
  return filtered;
}

/**
 * fetch() with SSRF protection at every layer:
 *  - the target is asserted safe before sending,
 *  - automatic redirects are replaced with a bounded, per-hop-validated loop,
 *  - the connection is pinned to a connect-time re-validated DNS resolution,
 *  - bearer credentials are stripped on every redirect hop so a provider that
 *    redirects to another origin can never receive the caller's token.
 */
export async function safeFetch(url, init = {}, env = process.env) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertSafeOutboundUrl(current, env);

    const hopInit = { ...init };
    if (hop > 0) {
      // The redirect target never received the caller's trust: never forward
      // credential-carrying headers across hops.
      hopInit.headers = withoutCredentialHeaders(hopInit.headers);
    }

    const response = await undiciFetch(current, {
      ...hopInit,
      redirect: 'manual',
      dispatcher: getPinnedAgent(env),
    });

    const status = response.status;
    if (status >= 300 && status < 400) {
      if (init.redirect === 'error') {
        throw new Error(`Redirect blocked by policy for ${current}`);
      }
      if (init.redirect === 'manual') {
        return response;
      }
      const location = response.headers.get('location');
      if (!location) {
        return response; // cannot follow without a Location header
      }
      const next = new URL(location, current).toString();
      await assertSafeOutboundUrl(next, env);
      current = next;
      continue;
    }

    return response;
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS}) while fetching ${url}`);
}
