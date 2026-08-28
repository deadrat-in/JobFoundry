/**
 * indeed.js — DOM extractor for Indeed job pages.
 * Supports:
 *   1. JSON-LD schema.org extraction
 *   2. Single job view (/viewjob or search split-view detail pane)
 *   3. Search results cards (.job_seen_beacon, .resultContent)
 */

import {
  cleanText,
  absolutizeUrl,
  getCanonicalUrl,
  extractJsonLd,
  jdHtmlToText,
} from './helpers.js';

export function extractIndeedJobDetails(doc) {
  if (!doc) return null;

  // Tier 1: Try JSON-LD Schema.org
  const jsonLd = extractJsonLd(doc);
  if (jsonLd && jsonLd.description && jsonLd.description.length > 50) {
    return {
      ...jsonLd,
      source: 'indeed',
    };
  }

  // Tier 2: DOM Selectors
  const titleEl =
    doc.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]') ||
    doc.querySelector('.jobsearch-JobInfoHeader-title') ||
    doc.querySelector('h1.jobsearch-JobInfoHeader-title') ||
    doc.querySelector('h1');

  const title = cleanText(titleEl?.textContent);
  if (!title) return null;

  const companyEl =
    doc.querySelector('[data-testid="inlineHeader-companyName"]') ||
    doc.querySelector('.jobsearch-CompanyInfoContainer a') ||
    doc.querySelector('.jobsearch-InlineCompanyRating-companyHeader') ||
    doc.querySelector('[data-testid="company-name"]');
  const company = cleanText(companyEl?.textContent) || 'Indeed Company';

  const locEl =
    doc.querySelector('[data-testid="inlineHeader-companyLocation"]') ||
    doc.querySelector('.jobsearch-JobInfoHeader-companyLocation') ||
    doc.querySelector('[data-testid="job-location"]') ||
    doc.querySelector('[data-testid="text-location"]');
  const location = cleanText(locEl?.textContent) || null;

  const descEl =
    doc.querySelector('#jobDescriptionText') ||
    doc.querySelector('.jobsearch-JobComponent-description') ||
    doc.querySelector('.jobsearch-jobDescriptionText');
  const description = descEl
    ? jdHtmlToText(descEl.innerHTML || descEl.textContent || '')
    : '';

  const salaryEl =
    doc.querySelector('#salaryInfoAndJobType') ||
    doc.querySelector('[data-testid="attribute_snippets_test_id"]');
  const salary = cleanText(salaryEl?.textContent) || null;

  const url = getCanonicalUrl(doc) || doc.location?.href || '';

  return {
    title,
    company,
    location,
    salary,
    description,
    url,
    source: 'indeed',
    postedAt: null,
  };
}

export function extractIndeedSearchCards(doc) {
  if (!doc) return [];

  const cards = doc.querySelectorAll(
    '.job_seen_beacon, .resultContent, [data-testid="slider_item"]'
  );
  const results = [];
  const seenUrls = new Set();

  for (const card of cards) {
    const linkEl =
      card.querySelector('a.jcs-JobTitle') ||
      card.querySelector('h2.jobTitle a') ||
      card.querySelector('a[data-jk]');

    const rawUrl = linkEl?.getAttribute('href');
    const jk = linkEl?.getAttribute('data-jk') || linkEl?.dataset?.jk;
    let url = absolutizeUrl(rawUrl, doc.location?.href || 'https://www.indeed.com');
    if (!url && jk) {
      url = `https://www.indeed.com/viewjob?jk=${jk}`;
    }

    const title = cleanText(linkEl?.textContent);
    if (!title || !url || seenUrls.has(url)) continue;
    seenUrls.add(url);

    const companyEl =
      card.querySelector('[data-testid="company-name"]') ||
      card.querySelector('.companyName') ||
      card.querySelector('span.css-63koeb');
    const company = cleanText(companyEl?.textContent) || 'Indeed Company';

    const locEl =
      card.querySelector('[data-testid="text-location"]') ||
      card.querySelector('.companyLocation') ||
      card.querySelector('div.css-1p0sjhy');
    const location = cleanText(locEl?.textContent) || null;

    const snippetEl = card.querySelector('.job-snippet, .underShelfFooter');
    const description = snippetEl ? cleanText(snippetEl.textContent) : '';

    results.push({
      title,
      company,
      location,
      url,
      source: 'indeed',
      description,
      postedAt: null,
    });
  }

  return results;
}

export function extractIndeed(doc) {
  const detail = extractIndeedJobDetails(doc);
  if (detail && detail.description) {
    return [detail];
  }
  const cards = extractIndeedSearchCards(doc);
  if (cards.length > 0) {
    return cards;
  }
  return detail ? [detail] : [];
}
