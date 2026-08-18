/**
 * index.js — Extractor router based on current hostname / document context.
 */

import { extractLinkedIn } from './linkedin.js';
import { extractIndeed } from './indeed.js';
import { extractGlassdoor } from './glassdoor.js';
import { extractNaukri } from './naukri.js';

export function detectPlatform(urlOrHostname) {
  if (!urlOrHostname) return null;
  const str = String(urlOrHostname).toLowerCase();
  if (str.includes('linkedin.com')) return 'linkedin';
  if (str.includes('indeed.com') || str.includes('indeed.')) return 'indeed';
  if (str.includes('glassdoor.com') || str.includes('glassdoor.')) return 'glassdoor';
  if (str.includes('naukri.com')) return 'naukri';
  return null;
}

export function extractJobsFromDocument(doc) {
  if (!doc) return [];
  const href = doc.location?.href || '';
  const hostname = doc.location?.hostname || '';
  const platform = detectPlatform(hostname || href);

  switch (platform) {
    case 'linkedin':
      return extractLinkedIn(doc);
    case 'indeed':
      return extractIndeed(doc);
    case 'glassdoor':
      return extractGlassdoor(doc);
    case 'naukri':
      return extractNaukri(doc);
    default:
      return [];
  }
}

export { extractLinkedIn, extractIndeed, extractGlassdoor, extractNaukri };
