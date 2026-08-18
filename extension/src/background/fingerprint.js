/**
 * fingerprint.js — JD-content fingerprinting for the extension (browser port).
 *
 * Ported from career-ops fingerprint-core.mjs (MIT, vendored via
 * scripts/vendor.mjs). The SimHash design is unchanged; the only deviation is
 * the shingle digest: upstream used node:crypto's synchronous SHA-1, which the
 * browser cannot run, so this port digests each shingle with WebCrypto
 * crypto.subtle.digest('SHA-256') (an async op). To keep the hot loop clean,
 * shingles are batched and hashed in parallel, then folded into weights in
 * order. Because SHA-1 and SHA-256 differ, fingerprints here are NOT
 * cross-comparable with the server's node-crypto SHA-1 fingerprint — that is
 * fine: fingerprints are only ever compared within the same module, and the
 * server recomputes row identity from its own fingerprint-core port.
 *
 * The rest of the module (normalizeJdText, similarity, findCrossListings) is
 * copied verbatim, so it runs unchanged in the browser.
 */

/** Unicode-aware company matching key (inlined from tracker-parse.mjs
 * `normalizeTextKey`, as the server fingerprint-core port does). NFKC, lower,
 * strip combining dot, keep letters/marks/numbers. */
export function normalizeTextKey(value, separator = '') {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/̇/gu, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, separator)
    .trim();
}

/** Descriptions shorter than this (after normalization) carry too little
 * signal to distinguish real matches from boilerplate — skip them. */
export const FINGERPRINT_MIN_TEXT = 200;

/** Similarity at or above this is reported as a possible cross-listing.
 * 0.92 ≈ at most 5 of 64 SimHash bits differ — near-verbatim bodies. */
export const CROSSLIST_THRESHOLD = 0.92;

/** Only compare against history this recent (mirrors detect-reposts.mjs). */
export const CROSSLIST_WINDOW_DAYS = 90;

/**
 * Normalize JD text for shingling: strip tags/entities/URLs, lowercase,
 * collapse everything non-alphanumeric (unicode-aware) to single spaces.
 */
export function normalizeJdText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Maximum number of shingles folded in one WebCrypto batch — keeps each
 * crypto.subtle call a bounded, GC-friendly size. */
const SHINGLE_BATCH = 512;

function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  return crypto.subtle.digest('SHA-256', data).then((buf) => {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  });
}

/**
 * 64-bit SimHash of a text, as 16 lowercase hex chars — or '' when the
 * normalized text is too short to fingerprint (see FINGERPRINT_MIN_TEXT).
 *
 * Async because shingles are hashed via WebCrypto (see header note).
 *
 * @param {string} text - Raw description text.
 * @returns {Promise<string>} 16-hex-char fingerprint, or '' when not fingerprintable.
 */
export async function fingerprintText(text) {
  const normalized = normalizeJdText(text);
  if (normalized.length < FINGERPRINT_MIN_TEXT) return '';
  const tokens = normalized.split(' ');
  if (tokens.length < 3) return '';
  const shingles = [];
  for (let i = 0; i <= tokens.length - 3; i++) {
    shingles.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }

  const weights = new Array(64).fill(0);
  // Batched parallel hashing preserves order: fold batch k's digests into
  // weights before batch k+1's, so the result is identical to a sequential
  // fold regardless of how the individual awaits interleave.
  for (let batch = 0; batch < shingles.length; batch += SHINGLE_BATCH) {
    const slice = shingles.slice(batch, batch + SHINGLE_BATCH);
    const digests = await Promise.all(slice.map(sha256Hex));
    for (const hex of digests) {
      // First 8 bytes of the SHA-256 as the shingle's 64-bit hash.
      for (let bit = 0; bit < 64; bit++) {
        const byte = parseInt(hex.substr((bit >> 3) * 2, 2), 16);
        weights[bit] += (byte >> (7 - (bit & 7))) & 1 ? 1 : -1;
      }
    }
  }

  let hash = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (weights[bit] > 0) hash |= 1n << BigInt(63 - bit);
  }
  return hash.toString(16).padStart(16, '0');
}

/** A fingerprint is exactly 16 lowercase hex chars; anything else never
 * matches. */
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;

/** Set-bit count for every 16-bit value, built once at module load (64 KB). */
const POPCOUNT16 = (() => {
  const table = new Uint8Array(1 << 16);
  for (let i = 1; i < table.length; i++) table[i] = table[i >> 1] + (i & 1);
  return table;
})();

function popcount32(x) {
  return POPCOUNT16[x & 0xffff] + POPCOUNT16[(x >>> 16) & 0xffff];
}

function splitFingerprint(fp) {
  const s = String(fp);
  return { hi: parseInt(s.slice(0, 8), 16) | 0, lo: parseInt(s.slice(8, 16), 16) | 0 };
}

/**
 * Similarity of two fingerprints: 1 − hammingDistance/64. Empty or malformed
 * fingerprints never match (returns 0).
 */
export function similarity(a, b) {
  if (!FINGERPRINT_RE.test(a || '') || !FINGERPRINT_RE.test(b || '')) return 0;
  const x = splitFingerprint(a);
  const y = splitFingerprint(b);
  return 1 - (popcount32(x.hi ^ y.hi) + popcount32(x.lo ^ y.lo)) / 64;
}

function maxDistanceFor(threshold) {
  for (let d = 0; d <= 64; d++) {
    if (!(1 - d / 64 >= threshold)) return d - 1;
  }
  return 64;
}

function companyKey(name) {
  return normalizeTextKey(String(name ?? ''));
}

/**
 * Find possible cross-listings: new offers whose fingerprint is near-identical
 * to a recent history row from a DIFFERENT company. Same-company matches are
 * re-posts, not cross-listings — skipped here.
 *
 * Copied verbatim from career-ops (see header note).
 */
export function findCrossListings(offers, historyRows, opts = {}) {
  const threshold = opts.threshold ?? CROSSLIST_THRESHOLD;
  const windowDays = opts.windowDays ?? CROSSLIST_WINDOW_DAYS;
  const today = opts.today ? new Date(opts.today) : new Date();
  const cutoff = today.getTime() - windowDays * 86400000;
  const maxDist = maxDistanceFor(threshold);
  const zeroScores = 0 >= threshold;

  const recent = [];
  for (const row of historyRows) {
    if (!row.fingerprint) continue;
    const t = Date.parse(row.dateStr);
    if (Number.isNaN(t) || t < cutoff) continue;
    const valid = FINGERPRINT_RE.test(row.fingerprint);
    const half = valid ? splitFingerprint(row.fingerprint) : null;
    recent.push({
      row,
      key: companyKey(row.company),
      url: row.url,
      valid,
      hi: half ? half.hi : 0,
      lo: half ? half.lo : 0,
    });
  }

  const matches = [];
  for (const offer of offers) {
    if (!offer.fingerprint) continue;
    const offerCompany = companyKey(offer.company);
    const offerValid = FINGERPRINT_RE.test(offer.fingerprint);
    if (!offerValid && !zeroScores) continue;
    const half = offerValid ? splitFingerprint(offer.fingerprint) : null;
    const offerHi = half ? half.hi : 0;
    const offerLo = half ? half.lo : 0;
    for (const cand of recent) {
      if (cand.key === offerCompany) continue;
      if (cand.url === offer.url) continue;
      let score;
      if (offerValid && cand.valid) {
        const dist = popcount32(offerHi ^ cand.hi) + popcount32(offerLo ^ cand.lo);
        if (dist > maxDist) continue;
        score = 1 - dist / 64;
      } else {
        if (!zeroScores) continue;
        score = 0;
      }
      matches.push({ offer, row: cand.row, score });
    }
  }
  return matches.sort((a, b) => b.score - a.score);
}
