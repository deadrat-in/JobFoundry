/**
 * naukri.js — DOM extractor for Naukri job pages.
 * Supports:
 *   1. Single job view (styles_jdc__top-section, styles_job-desc-container)
 *   2. Search results cards (.srp-jobtuple-wrapper, .jobTuple)
 */

import { cleanText, absolutizeUrl, getCanonicalUrl } from './helpers.js';

export function extractNaukriJobDetails(doc) {
  if (!doc) return null;

  const titleEl =
    doc.querySelector('[class*="styles_jdc__top-section__title"]') ||
    doc.querySelector('[class*="styles_jd-header-title"]') ||
    doc.querySelector('h1.title');

  const title = cleanText(titleEl?.textContent);
  if (!title) return null;

  const companyEl =
    doc.querySelector('[class*="styles_jdc__top-section__company-name"]') ||
    doc.querySelector('a.comp-name') ||
    doc.querySelector('.company-name');
  const company = cleanText(companyEl?.textContent);

  const locEl =
    doc.querySelector('[class*="styles_jdc__top-section__location"]') ||
    doc.querySelector('.loc-wrap') ||
    doc.querySelector('.location');
  const location = cleanText(locEl?.textContent) || null;

  const descEl =
    doc.querySelector('[class*="styles_job-desc-container"]') ||
    doc.querySelector('[class*="styles_JDC__dang-inner-html"]') ||
    doc.querySelector('.dang-inner-html');
  const description = cleanText(descEl?.textContent);

  const salaryEl =
    doc.querySelector('[class*="styles_jdc__top-section__salary"]') ||
    doc.querySelector('.sal-wrap') ||
    doc.querySelector('.salary');
  const salary = cleanText(salaryEl?.textContent) || null;

  const url = getCanonicalUrl(doc) || doc.location?.href || '';

  return {
    title,
    company,
    location,
    salary,
    description,
    url,
    source: 'naukri',
    postedAt: null,
  };
}

export function extractNaukriSearchCards(doc) {
  if (!doc) return [];

  const cards = doc.querySelectorAll('.srp-jobtuple-wrapper, .jobTuple, article.jobTuple');
  const results = [];

  for (const card of cards) {
    const linkEl = card.querySelector('a.title') || card.querySelector('a[href*="job-listings"]');
    const rawUrl = linkEl?.getAttribute('href');
    const url = absolutizeUrl(rawUrl, doc.location?.href || 'https://www.naukri.com');
    const title = cleanText(linkEl?.textContent);
    if (!title || !url) continue;

    const companyEl = card.querySelector('a.comp-name') || card.querySelector('.companyName');
    const company = cleanText(companyEl?.textContent);

    const locEl = card.querySelector('.loc-wrap, .locWdth, .location');
    const location = cleanText(locEl?.textContent) || null;

    const snippetEl = card.querySelector('.job-desc, .row6, .job-description');
    const description = cleanText(snippetEl?.textContent);

    results.push({
      title,
      company,
      location,
      url,
      source: 'naukri',
      description,
      postedAt: null,
    });
  }

  return results;
}

export function extractNaukri(doc) {
  const detail = extractNaukriJobDetails(doc);
  if (detail && detail.description) {
    return [detail];
  }
  const cards = extractNaukriSearchCards(doc);
  if (cards.length > 0) {
    return cards;
  }
  return detail ? [detail] : [];
}
