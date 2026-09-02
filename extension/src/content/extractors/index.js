/**
 * index.js — Extractor router based on current hostname / document context.
 */

import { extractLinkedIn } from './linkedin.js';
import { extractIndeed } from './indeed.js';
import { extractGlassdoor } from './glassdoor.js';
import { extractNaukri } from './naukri.js';
import { extractGreenhouse, extractLever, extractAshby, extractGenericJob } from './ats.js';

export function detectPlatform(urlOrHostname) {
  if (!urlOrHostname) return null;
  const str = String(urlOrHostname).toLowerCase();
  if (str.includes('linkedin.com')) return 'linkedin';
  if (str.includes('indeed.com') || str.includes('indeed.')) return 'indeed';
  if (str.includes('glassdoor.com') || str.includes('glassdoor.')) return 'glassdoor';
  if (str.includes('naukri.com')) return 'naukri';
  if (str.includes('greenhouse.io')) return 'greenhouse';
  if (str.includes('lever.co')) return 'lever';
  if (str.includes('ashbyhq.com')) return 'ashby';
  return null;
}

import { isNoiseTitle } from './helpers.js';

export function extractJobsFromDocument(doc) {
  if (!doc) return [];
  const href = doc.location?.href || '';
  const pathname = doc.location?.pathname || '';
  const hostname = doc.location?.hostname || '';
  const platform = detectPlatform(hostname || href);

  // If on known non-job paths on social job boards like LinkedIn, skip extraction
  if (
    platform === 'linkedin' &&
    pathname &&
    (pathname.startsWith('/notifications') ||
      pathname.startsWith('/mynetwork') ||
      pathname.startsWith('/feed') ||
      pathname.startsWith('/messaging') ||
      pathname.startsWith('/in/'))
  ) {
    return [];
  }

  let results = [];
  switch (platform) {
    case 'linkedin':
      results = extractLinkedIn(doc);
      break;
    case 'indeed':
      results = extractIndeed(doc);
      break;
    case 'glassdoor':
      results = extractGlassdoor(doc);
      break;
    case 'naukri':
      results = extractNaukri(doc);
      break;
    case 'greenhouse':
      results = extractGreenhouse(doc);
      break;
    case 'lever':
      results = extractLever(doc);
      break;
    case 'ashby':
      results = extractAshby(doc);
      break;
    case 'generic':
      results = extractGenericJob(doc);
      break;
    default:
      results = [];
  }

  // Fallback to JSON-LD / Semantic DOM extraction if specific extractor yielded nothing
  if ((!results || results.length === 0) && platform !== null) {
    results = extractGenericJob(doc);
  } else if (!results || results.length === 0) {
    results = extractGenericJob(doc);
  }

  return (results || []).filter((j) => j && j.title && !isNoiseTitle(j.title));
}

export {
  extractLinkedIn,
  extractIndeed,
  extractGlassdoor,
  extractNaukri,
  extractGreenhouse,
  extractLever,
  extractAshby,
  extractGenericJob,
};
