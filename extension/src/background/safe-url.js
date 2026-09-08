/**
 * safe-url.js — SSRF destination policy, IP address guard, and safe redirect fetcher.
 *
 * Enforces that companion extension fetches target only public internet destinations:
 * - Rejects private, loopback, link-local, cloud metadata, and reserved IP ranges.
 * - Rejects localhost and internal domain names (.local, .internal, .lan, etc.).
 * - Validates DNS resolution before connecting.
 * - Re-validates every redirect destination hop to prevent redirect-based SSRF.
 */

const V4_BLOCKED = [
  [0x00000000, 8], // 0.0.0.0/8      "this network"
  [0x0a000000, 8], // 10.0.0.0/8     RFC1918
  [0x64400000, 10], // 100.64.0.0/10  CGNAT
  [0x7f000000, 8], // 127.0.0.0/8    loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 link-local + cloud metadata (169.254.169.254)
  [0xac100000, 12], // 172.16.0.0/12  RFC1918
  [0xc0000000, 24], // 192.0.0.0/24   IETF protocol assignments
  [0xc0a80000, 16], // 192.168.0.0/16 RFC1918
  [0xc6120000, 15], // 198.18.0.0/15  benchmarking
  [0xe0000000, 4], // 224.0.0.0/4    multicast
  [0xf0000000, 4], // 240.0.0.0/4    reserved (includes 255.255.255.255)
];

const BLOCKED_HOST_SUFFIXES = [
  '.local',
  '.internal',
  '.localhost',
  '.lan',
  '.home.arpa',
  '.localdomain',
  '.intranet',
];

const DISALLOWED_PORTS = new Set([
  21, 22, 23, 25, 53, 69, 110, 135, 137, 138, 139, 143, 389, 445, 636, 1433, 1521, 2049, 2375, 2376,
  3306, 3389, 5432, 5900, 6379, 9200, 11211, 27017, 28017,
]);

/** Dotted-quad -> uint32, or null when it is not a well-formed IPv4 literal. */
export function v4ToInt(address) {
  const parts = String(address).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/**
 * Returns true if the address is a private, loopback, link-local, or reserved IP.
 */
export function isBlockedAddress(address) {
  const raw = String(address ?? '').trim();
  if (!raw) return true;

  const addr = raw.split('%')[0].toLowerCase();
  const asV4 = v4ToInt(addr);
  if (asV4 !== null) {
    return V4_BLOCKED.some(([net, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (asV4 & mask) >>> 0 === net;
    });
  }

  if (!addr.includes(':')) return true;

  const tail = addr.slice(addr.lastIndexOf(':') + 1);
  if (tail.includes('.')) {
    const embedded = v4ToInt(tail);
    return embedded === null ? true : isBlockedAddress(tail);
  }

  if (addr === '::' || addr === '::1') return true;
  if (/^f[cd]/.test(addr)) return true; // unique local
  if (/^fe[89ab]/.test(addr)) return true; // link-local
  if (/^ff/.test(addr)) return true; // multicast
  return false;
}

/**
 * Default DNS lookup: uses node:dns if in Node.js, otherwise queries DoH.
 */
export async function defaultDnsLookup(hostname, fetchImpl = globalThis.fetch) {
  if (typeof globalThis.process !== 'undefined' && globalThis.process.release?.name === 'node') {
    try {
      const dnsMod = 'node:dns';
      const dns = await import(/* @vite-ignore */ dnsMod);
      const res = await dns.promises.lookup(hostname, { all: true });
      return res.map((r) => r.address);
    } catch {
      return [];
    }
  }

  // Browser / WebExtension runtime: query DNS over HTTPS (Cloudflare / Google)
  try {
    const res = await fetchImpl(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      { headers: { Accept: 'application/dns-json' } }
    );
    if (res.ok) {
      const data = await res.json();
      const addresses = [];
      if (Array.isArray(data?.Answer)) {
        for (const ans of data.Answer) {
          if (ans.data) addresses.push(ans.data);
        }
      }
      return addresses;
    }
  } catch {}

  return [];
}

/**
 * Validates a destination URL against private network policies.
 * Throws an Error if the URL points to a private or disallowed destination.
 */
export async function assertSafeDestination(
  urlStr,
  { lookupImpl = null, fetchImpl = globalThis.fetch } = {}
) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL: "${urlStr}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Forbidden scheme "${parsed.protocol}" — only HTTP and HTTPS are permitted`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('Userinfo (credentials) in URL is forbidden');
  }

  const hostname = parsed.hostname.toLowerCase().trim();
  if (!hostname) {
    throw new Error('URL hostname cannot be empty');
  }

  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (DISALLOWED_PORTS.has(portNum)) {
      throw new Error(`Destination forbidden: port ${portNum} is restricted`);
    }
  }

  if (hostname === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new Error(
      `Destination forbidden: hostname "${hostname}" targets local or private network`
    );
  }

  const bareHost =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

  // Direct IP literal check
  const isV4Literal = v4ToInt(bareHost) !== null;
  const isV6Literal = bareHost.includes(':');

  if (isV4Literal || isV6Literal) {
    if (isBlockedAddress(bareHost)) {
      throw new Error(`Destination forbidden: "${hostname}" is a private or reserved IP address`);
    }
    return parsed;
  }

  // Reject single-label hosts (e.g. http://router/ or http://internal-server/)
  if (!hostname.includes('.')) {
    throw new Error(`Destination forbidden: single-label host "${hostname}" is disallowed`);
  }

  // DNS resolution check
  let addresses = [];
  if (typeof lookupImpl === 'function') {
    addresses = await lookupImpl(hostname);
  } else {
    addresses = await defaultDnsLookup(hostname, fetchImpl);
  }

  if (Array.isArray(addresses)) {
    for (const addr of addresses) {
      if (isBlockedAddress(addr)) {
        throw new Error(
          `Destination forbidden: "${hostname}" resolves to private/reserved IP "${addr}"`
        );
      }
    }
  }

  return parsed;
}

/**
 * Fetches a URL with manual redirect checking, verifying the destination policy at every hop.
 */
export async function fetchWithSafeRedirects(
  initialUrl,
  opts = {},
  { lookupImpl = null, fetchImpl = globalThis.fetch, maxRedirects = 5 } = {}
) {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertSafeDestination(currentUrl, { lookupImpl, fetchImpl });

    const fetchOpts = {
      ...opts,
      redirect: 'manual',
    };

    const res = await fetchImpl(currentUrl, fetchOpts);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers?.get ? res.headers.get('location') : null;
      if (!location) {
        throw new Error(
          `HTTP ${res.status} redirect without Location header cannot be safely followed`
        );
      }
      const nextUrl = new URL(location, currentUrl).href;
      currentUrl = nextUrl;
      continue;
    }

    if (res.type === 'opaqueredirect') {
      throw new Error('Opaque redirect cannot be safely verified');
    }

    return res;
  }

  throw new Error(`Exceeded maximum redirect limit of ${maxRedirects}`);
}
