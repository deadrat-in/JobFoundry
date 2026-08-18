/**
 * helpers.js — DOM extraction utility functions.
 */

export function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function absolutizeUrl(rawUrl, baseUrl = 'https://localhost') {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl, baseUrl);
    return parsed.href;
  } catch {
    return '';
  }
}

export function getCanonicalUrl(doc) {
  if (!doc) return '';
  const canonical = doc.querySelector('link[rel="canonical"]');
  if (canonical && canonical.getAttribute('href')) {
    return canonical.getAttribute('href');
  }
  return doc.location?.href || '';
}
