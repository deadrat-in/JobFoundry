/**
 * date-filter.js — Posting age filter for JobFoundry extension.
 */

/**
 * Filter jobs by max posting age (in days).
 * Jobs with missing or unparseable dates are preserved (conservative).
 *
 * @param {number} maxAgeDays
 * @param {number} [now]
 * @returns {(job: { postedAt?: number | string | null }) => boolean}
 */
export function buildDateFilter(maxAgeDays, now = Date.now) {
  if (!maxAgeDays || typeof maxAgeDays !== 'number' || maxAgeDays <= 0) {
    return () => true;
  }

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  return function isWithinAge(job) {
    if (!job?.postedAt) {
      return true; // No date -> pass
    }

    let timestamp = job.postedAt;
    if (typeof timestamp === 'string') {
      timestamp = Date.parse(timestamp);
    }

    if (typeof timestamp !== 'number' || Number.isNaN(timestamp)) {
      return true;
    }

    const age = now() - timestamp;
    // Allow small future clock drift up to 1 day
    return age <= maxAgeMs && age >= -86400000;
  };
}
