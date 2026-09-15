/**
 * index.js — Extractor router based on current hostname / document context.
 */

import { extractLinkedIn } from './linkedin.js';
import { extractIndeed } from './indeed.js';
import { extractGlassdoor } from './glassdoor.js';
import { extractNaukri } from './naukri.js';
import { extractGreenhouse, extractLever, extractAshby, extractGenericJob } from './ats.js';
import { isSupportedGlassdoorHost, isSupportedIndeedHost } from '../../shared/supported-domains.js';

/**
 * Identify the supported job platform represented by a URL or hostname.
 *
 * @param {string} urlOrHostname - A complete URL or bare hostname to classify.
 * @returns {string|null} The platform identifier, or null when the host is unsupported.
 */
export function detectPlatform(urlOrHostname) {
  if (!urlOrHostname) return null;
  let host = String(urlOrHostname).toLowerCase().trim();
  try {
    if (host.includes('://')) {
      host = new URL(host).hostname.toLowerCase();
    } else {
      host = host.split('/')[0].split(':')[0];
    }
  } catch {
    host = host.split('/')[0].split(':')[0];
  }

  const isDomain = (d) => host === d || host.endsWith('.' + d);

  if (isDomain('linkedin.com')) return 'linkedin';
  if (isSupportedIndeedHost(host)) return 'indeed';
  if (isSupportedGlassdoorHost(host)) return 'glassdoor';
  if (isDomain('naukri.com')) return 'naukri';
  if (isDomain('greenhouse.io')) return 'greenhouse';
  if (isDomain('lever.co')) return 'lever';
  if (isDomain('ashbyhq.com')) return 'ashby';
  return null;
}

import { isNoiseTitle } from './helpers.js';

/**
 * Extract job postings from a DOM Document object using platform-specific or generic extractors.
 *
 * @param {Document} doc - The DOM Document to extract job postings from.
 * @returns {Array<object>} List of extracted and sanitized job postings.
 */
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

  let results;
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
