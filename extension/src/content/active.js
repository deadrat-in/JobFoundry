/**
 * active.js — Active scraper module for paginating through search results.
 * Opt-in with jittered human delays and rate-limiting.
 */

import { extractJobsFromDocument } from './extractors/index.js';

export function findNextPageButton(doc) {
  if (!doc) return null;

  // LinkedIn pagination
  const liNext =
    doc.querySelector('button[aria-label="Next"]') ||
    doc.querySelector('button.jobs-search-pagination__button--next') ||
    doc.querySelector('.artdeco-pagination__button--next');
  if (liNext && !liNext.disabled) return liNext;

  // Indeed pagination
  const indeedNext =
    doc.querySelector('a[data-testid="pagination-page-next"]') ||
    doc.querySelector('a[aria-label="Next Page"]') ||
    doc.querySelector('a[aria-label="Next"]');
  if (indeedNext) return indeedNext;

  // Glassdoor pagination
  const gdNext =
    doc.querySelector('button[data-test="pagination-next"]') ||
    doc.querySelector('button[aria-label="Next"]');
  if (gdNext && !gdNext.disabled) return gdNext;

  // Naukri pagination
  const naukriNext =
    doc.querySelector('a.styles_btn__dpp1n[href*="job-listings"]') ||
    doc.querySelector('a.fleft.pages');
  if (naukriNext) return naukriNext;

  return null;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runActiveCrawl({
  doc = typeof document !== 'undefined' ? document : null,
  maxPages = 3,
  minDelayMs = 1500,
  maxDelayMs = 3000,
  onJobs = null,
} = {}) {
  if (!doc) throw new Error('document is required for active crawl');

  let pagesVisited = 0;
  const allJobs = [];

  while (pagesVisited < maxPages) {
    const jobs = extractJobsFromDocument(doc);
    if (jobs.length > 0) {
      allJobs.push(...jobs);
      if (typeof onJobs === 'function') {
        onJobs(jobs, pagesVisited + 1);
      }
    }
    pagesVisited++;

    if (pagesVisited >= maxPages) break;

    const nextBtn = findNextPageButton(doc);
    if (!nextBtn) break;

    // Jittered delay to behave respectfully
    const delay = minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs));
    await sleep(delay);

    if (typeof nextBtn.click === 'function') {
      nextBtn.click();
    } else {
      break;
    }

    // Give page time to load new DOM
    await sleep(minDelayMs);
  }

  return { pagesVisited, totalJobsFound: allJobs.length, jobs: allJobs };
}
