/**
 * detect-reposts.mjs — Heuristics to detect evergreen / recycled ghost postings.
 *
 * Adapted from career-ops detect-reposts.mjs (MIT).
 * Compares job listings within a company catalog over time to identify
 * roles that are repeatedly renewed without active hiring.
 */

const TITLE_STOP_WORDS = new Set([
  'senior',
  'sr',
  'junior',
  'jr',
  'lead',
  'principal',
  'staff',
  'remote',
  'hybrid',
  'onsite',
  'full',
  'time',
  'part',
]);

const COMPANY_STOP_WORDS = new Set(['inc', 'corp', 'corporation', 'ltd', 'llc', 'gmbh', 'co']);

/**
 * Normalize a job title for repost comparisons by removing common qualifiers.
 *
 * @param {string} title - The job title to normalize.
 * @returns {string} A lowercase, space-delimited comparison key.
 */
export function normalizeJobTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !TITLE_STOP_WORDS.has(w))
    .join(' ');
}

/**
 * Normalize a company name for repost comparisons by removing legal suffixes.
 *
 * @param {string} company - The company name to normalize.
 * @returns {string} A lowercase, space-delimited comparison key.
 */
export function normalizeCompany(company) {
  if (!company || typeof company !== 'string') return '';
  return company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !COMPANY_STOP_WORDS.has(w))
    .join(' ');
}

/**
 * Checks a job against existing catalog of company listings.
 *
 * @param {Object} job - Target job { title, company, posted_at, url }
 * @param {Array} history - Array of previous jobs { id, title, company, posted_at, url, created_at }
 * @param {Object} opts - Options { repostThresholdDays = 45 }
 * @returns {Object} { isRepost: boolean, count: number, daysSpan: number, confidence: 'high'|'medium'|'none' }
 */
export function analyzeRepost(job, history = [], { repostThresholdDays = 45 } = {}) {
  if (!job || !job.title || !job.company) {
    return { isRepost: false, count: 0, daysSpan: 0, confidence: 'none' };
  }

  const normTitle = normalizeJobTitle(job.title);
  const normComp = normalizeCompany(job.company);

  if (!normTitle || !normComp) {
    return { isRepost: false, count: 0, daysSpan: 0, confidence: 'none' };
  }

  const matches = [];
  const currentUrl = job.url || '';
  const currentPosted = job.posted_at || job.created_at || Date.now();

  for (const prev of history) {
    if (prev.url === currentUrl) continue; // Same job listing

    const prevComp = normalizeCompany(prev.company);
    if (prevComp !== normComp) continue;

    const prevTitle = normalizeJobTitle(prev.title);
    if (prevTitle === normTitle || normTitle.includes(prevTitle) || prevTitle.includes(normTitle)) {
      matches.push(prev);
    }
  }

  if (matches.length === 0) {
    return { isRepost: false, count: 0, daysSpan: 0, confidence: 'none' };
  }

  let earliest = currentPosted;
  let latest = currentPosted;

  for (const m of matches) {
    const time = m.posted_at || m.created_at || currentPosted;
    if (time < earliest) earliest = time;
    if (time > latest) latest = time;
  }

  const daysSpan = Math.round((latest - earliest) / (1000 * 60 * 60 * 24));
  const isRepost = daysSpan >= repostThresholdDays || matches.length >= 2;

  let confidence = 'none';
  if (matches.length >= 2 && daysSpan >= repostThresholdDays) confidence = 'high';
  else if (daysSpan >= repostThresholdDays || matches.length >= 1) confidence = 'medium';

  return {
    isRepost,
    count: matches.length,
    daysSpan,
    confidence,
    reason: isRepost
      ? `Seen ${matches.length} matching role(s) over ${daysSpan} days at ${job.company}`
      : 'First observed occurrence',
  };
}
