/**
 * glassdoor.js — DOM extractor for Glassdoor job pages.
 * Supports:
 *   1. JSON-LD schema.org extraction
 *   2. Job details pane / page ([data-test="job-details"], #JobDescriptionContainer)
 *   3. Search list cards ([data-test="jobListing"], .react-job-listing)
 */

import {
  cleanText,
  absolutizeUrl,
  getCanonicalUrl,
  extractJsonLd,
  jdHtmlToText,
} from './helpers.js';

export function extractGlassdoorJobDetails(doc) {
  if (!doc) return null;

  const jsonLd = extractJsonLd(doc);
  if (jsonLd && jsonLd.description && jsonLd.description.length > 50) {
    return { ...jsonLd, source: 'glassdoor' };
  }

  const titleEl =
    doc.querySelector('[data-test="job-title"]') ||
    doc.querySelector('[class*="JobDetails_jobTitle__"]') ||
    doc.querySelector('.job-title') ||
    doc.querySelector('h1');

  const title = cleanText(titleEl?.textContent);
  if (!title) return null;

  const companyEl =
    doc.querySelector('[data-test="employer-name"]') ||
    doc.querySelector('[class*="JobDetails_employerName__"]') ||
    doc.querySelector('.employer-name');
  const company = cleanText(companyEl?.textContent) || 'Glassdoor Company';

  const locEl =
    doc.querySelector('[data-test="location"]') ||
    doc.querySelector('[class*="JobDetails_location__"]') ||
    doc.querySelector('.location');
  const location = cleanText(locEl?.textContent) || null;

  const descEl =
    doc.querySelector('#JobDescriptionContainer') ||
    doc.querySelector('[class*="JobDetails_jobDescription__"]') ||
    doc.querySelector('.jobDescriptionContent') ||
    doc.querySelector('article');
  const description = descEl ? jdHtmlToText(descEl.innerHTML || descEl.textContent || '') : '';

  const salaryEl =
    doc.querySelector('[data-test="detailSalary"]') ||
    doc.querySelector('[class*="JobDetails_salary__"]');
  const salary = cleanText(salaryEl?.textContent) || null;

  const url = getCanonicalUrl(doc) || doc.location?.href || '';

  return {
    title,
    company,
    location,
    salary,
    description,
    url,
    source: 'glassdoor',
    postedAt: null,
  };
}

export function extractGlassdoorSearchCards(doc) {
  if (!doc) return [];

  const cards = doc.querySelectorAll(
    '[data-test="jobListing"], .react-job-listing, li[data-adv-id]'
  );
  const results = [];

  for (const card of cards) {
    const linkEl =
      card.querySelector('a[data-test="job-link"]') ||
      card.querySelector('a[class*="JobCard_jobTitle___"]') ||
      card.querySelector('a.jobLink');

    const rawUrl = linkEl?.getAttribute('href');
    const url = absolutizeUrl(rawUrl, doc.location?.href || 'https://www.glassdoor.com');
    const title = cleanText(
      linkEl?.textContent || card.querySelector('[data-test="job-title"]')?.textContent
    );
    if (!title || !url) continue;

    const companyEl =
      card.querySelector('[data-test="employer-name"]') ||
      card.querySelector('[class*="JobCard_employerName__"]') ||
      card.querySelector('.job-search-card__subtitle');
    const company = cleanText(companyEl?.textContent) || 'Glassdoor Company';

    const locEl =
      card.querySelector('[data-test="location"]') ||
      card.querySelector('[class*="JobCard_location__"]') ||
      card.querySelector('.job-search-card__location');
    const location = cleanText(locEl?.textContent) || null;

    results.push({
      title,
      company,
      location,
      url,
      source: 'glassdoor',
      description: '',
      postedAt: null,
    });
  }

  return results;
}

export function extractGlassdoor(doc) {
  const detail = extractGlassdoorJobDetails(doc);
  if (detail && detail.description) {
    return [detail];
  }
  const cards = extractGlassdoorSearchCards(doc);
  if (cards.length > 0) {
    return cards;
  }
  return detail ? [detail] : [];
}
