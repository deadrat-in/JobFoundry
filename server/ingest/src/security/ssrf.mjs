/**
 * Connection-time SSRF guard for outbound LLM requests.
 *
 * BYOK lets users supply arbitrary api_base hostnames, so the static provider
 * allowlist is no longer viable. Instead we block any destination that resolves
 * to a private / loopback / link-local / reserved IP. Operator-trusted internal
 * gateways (see getTrustedApiBaseOrigins) are exempt so self-hosted deployments
 * (Gatepass on :8318, local Ollama on :11434) keep working.
 *
 * Resolution and the IP-range check happen immediately before the request is
 * sent, minimising the DNS-rebinding window compared to validate-then-store.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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
  ['fc000000000000000000000000000000', 7], // fc00::/7 (ULA)
  ['fe800000000000000000000000000000', 10], // fe80::/10 (link-local)
  ['ff000000000000000000000000000000', 8], // ff00::/8 (multicast)
  ['20010db8000000000000000000000000', 32], // 2001:db8::/32 (documentation)
];

const V4_MAPPED_PREFIX = '00000000000000000000ffff';

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

  // IPv4-mapped IPv6 addresses (::ffff:1.2.3.4) inherit IPv4 policy
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
 * - Exempts operator-trusted origins (ALLOWED_LLM_BASES + local gateways).
 * - Resolves the hostname and blocks private/loopback/link-local/reserved IPs.
 * @returns {Promise<void>} resolves when the target is permitted.
 */
export async function assertSafeOutboundUrl(rawUrl, env = process.env) {
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

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error(`Connection to private/blocked IP is not allowed: ${hostname}`);
    }
    return;
  }

  let addresses = [];
  try {
    const res = await lookup(hostname, { all: true, family: 0, verbatim: true });
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
 * fetch() that first asserts the destination is not SSRF-eligible.
 */
export async function safeFetch(url, init, env = process.env) {
  await assertSafeOutboundUrl(url, env);
  return fetch(url, init);
}
