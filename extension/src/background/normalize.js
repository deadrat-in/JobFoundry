/**
 * normalize.js — map a provider job to the Phase 01 canonical ingest shape.
 *
 * The Phase 01 server (server/ingest/src/jobs/normalize.mjs) is the authority
 * on the canonical row; the extension's normalizer produces the payload the
 * ingest endpoint expects: { title, company, location, url, source, postedAt,
 * description, fingerprint }. Every field is defensively sanitized the same
 * way the server normalizer does, so nothing a hostile board returns can
 * violate the ingest schema.
 *
 * source is always the provider id (passed in) so the server can attribute
 * each job to the extension scan.
 */

const URL_RE = /^https?:\/\/\S+$/i;

export function normalizeJob(providerJob, source) {
  if (!providerJob || typeof providerJob !== 'object' || Array.isArray(providerJob)) {
    throw new TypeError('job must be an object');
  }
  const rawUrl = providerJob.url;
  if (typeof rawUrl !== 'string' || !URL_RE.test(rawUrl)) {
    throw new Error(`invalid url: ${String(rawUrl)}`);
  }
  const title = typeof providerJob.title === 'string' ? providerJob.title : '';
  const company = typeof providerJob.company === 'string' ? providerJob.company : '';
  const location =
    typeof providerJob.location === 'string' && providerJob.location !== ''
      ? providerJob.location
      : null;
  const description = typeof providerJob.description === 'string' ? providerJob.description : '';
  const postedAt = postedAtMs(providerJob.postedAt);

  return {
    title,
    company,
    location,
    url: rawUrl,
    source: typeof source === 'string' && source !== '' ? source : 'unknown',
    postedAt,
    description,
    fingerprint: '',
  };
}

function postedAtMs(postedAt) {
  if (postedAt === undefined || postedAt === null || postedAt === '') return null;
  if (typeof postedAt === 'number') return postedAt;
  const ms = Date.parse(postedAt);
  return Number.isNaN(ms) ? null : ms;
}

/** Attach the content fingerprint once computed (async, WebCrypto-backed). */
export async function withFingerprint(normalized, fingerprintTextFn) {
  const fp = await fingerprintTextFn(normalized.description);
  return { ...normalized, fingerprint: fp };
}
