import { createHash } from 'node:crypto';

const URL_RE = /^https?:\/\/\S+$/i;

function sha1(input) {
  return createHash('sha1').update(input).digest('hex');
}

function fingerprintId(fingerprint, url) {
  if (fingerprint) return sha1(`fingerprint:${fingerprint}`);
  return sha1(`url:${url}`);
}

function postedAtMs(postedAt) {
  if (postedAt === undefined || postedAt === null || postedAt === '') return null;
  if (typeof postedAt === 'number') return postedAt;
  const ms = Date.parse(postedAt);
  return Number.isNaN(ms) ? null : ms;
}

export function normalizeJob(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('job must be an object');
  }
  const url = raw.url;
  if (typeof url !== 'string' || !URL_RE.test(url)) {
    throw new Error(`invalid url: ${String(url)}`);
  }
  const fingerprint = typeof raw.fingerprint === 'string' ? raw.fingerprint : '';
  const now = Date.now();
  return {
    id: fingerprintId(fingerprint, url),
    title: typeof raw.title === 'string' ? raw.title : '',
    company: typeof raw.company === 'string' ? raw.company : '',
    location: typeof raw.location === 'string' && raw.location !== '' ? raw.location : null,
    url,
    source: typeof raw.source === 'string' && raw.source !== '' ? raw.source : 'unknown',
    posted_at: postedAtMs(raw.postedAt),
    description: typeof raw.description === 'string' ? raw.description : '',
    fingerprint,
    liveness: 'unknown',
    fit_score: null,
    fit_notes: null,
    status: 'new',
    tailored_resume_id: null,
    created_at: now,
    updated_at: now,
  };
}
