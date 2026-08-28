/**
 * linkedin.js — DOM extractor for LinkedIn job pages.
 * Supports:
 *   1. JSON-LD schema.org extraction (authoritative)
 *   2. Single job view (/jobs/view/* or collections detail pane)
 *   3. Search results list cards (.jobs-search-results-list, .job-card-container)
 */

import {
  cleanText,
  absolutizeUrl,
  getCanonicalUrl,
  extractJsonLd,
  jdHtmlToText,
} from './helpers.js';

export function extractLinkedInJobDetails(doc) {
  if (!doc) return null;

  // Tier 1: Try JSON-LD Schema.org JobPosting
  const jsonLd = extractJsonLd(doc);
  if (jsonLd && jsonLd.description && jsonLd.description.length > 50) {
    return {
      ...jsonLd,
      source: 'linkedin',
    };
  }

  // Tier 2: DOM Selectors
  const titleEl =
    doc.querySelector('.job-details-jobs-unified-top-card__job-title') ||
    doc.querySelector('.jobs-unified-top-card__job-title') ||
    doc.querySelector('.topcard__title') ||
    doc.querySelector('h1.t-24') ||
    doc.querySelector('h2.job-details-jobs-unified-top-card__job-title') ||
    doc.querySelector('.jobs-details__main-content h1') ||
    doc.querySelector('.job-view-layout h1') ||
    doc.querySelector('h1');

  const title = cleanText(titleEl?.textContent);
  if (!title) return null;

  const companyEl =
    doc.querySelector('.job-details-jobs-unified-top-card__company-name') ||
    doc.querySelector('.jobs-unified-top-card__company-name') ||
    doc.querySelector('.topcard__org-name-link') ||
    doc.querySelector('a.topcard__org-name-link') ||
    doc.querySelector(
      '.job-details-jobs-unified-top-card__primary-description-container a'
    ) ||
    doc.querySelector('a[href*="/company/"]');
  const company = cleanText(companyEl?.textContent) || 'LinkedIn Company';

  const locEl =
    doc.querySelector('.job-details-jobs-unified-top-card__bullet') ||
    doc.querySelector('.jobs-unified-top-card__bullet') ||
    doc.querySelector('.topcard__flavor--bullet') ||
    doc.querySelector(
      '.job-details-jobs-unified-top-card__primary-description-container span'
    );
  const location = cleanText(locEl?.textContent) || null;

  const descEl =
    doc.querySelector('#job-details') ||
    doc.querySelector('.jobs-description-content__text') ||
    doc.querySelector('.jobs-description__content') ||
    doc.querySelector('.jobs-box__html-content') ||
    doc.querySelector('.show-more-less-html__markup') ||
    doc.querySelector('.jobs-search__job-details--container') ||
    doc.querySelector('article');

  const description = descEl
    ? jdHtmlToText(descEl.innerHTML || descEl.textContent || '')
    : '';

  const salaryEl =
    doc.querySelector('.job-details-jobs-unified-top-card__job-insight') ||
    doc.querySelector('.compensation__salary');
  const salary = cleanText(salaryEl?.textContent) || null;

  const url = getCanonicalUrl(doc) || doc.location?.href || '';

  return {
    title,
    company,
    location,
    salary,
    description,
    url,
    source: 'linkedin',
    postedAt: null,
  };
}

export function extractLinkedInSearchCards(doc) {
  if (!doc) return [];

  const cards = doc.querySelectorAll(
    '.jobs-search-results-list li, .job-card-container, .base-card, .job-search-card, li[data-occludable-job-id]'
  );
  const results = [];
  const seenUrls = new Set();

  for (const card of cards) {
    const linkEl =
      card.querySelector('a.job-card-list__title--link') ||
      card.querySelector('a.job-card-container__link') ||
      card.querySelector('a.job-card-list__title') ||
      card.querySelector('a.base-card__full-link') ||
      card.querySelector('a[href*="/jobs/view/"]') ||
      card.querySelector('a[data-control-name="job_card_click"]') ||
      card.querySelector('a');

    const rawUrl = linkEl?.getAttribute('href');
    const url = absolutizeUrl(
      rawUrl,
      doc.location?.href || 'https://www.linkedin.com'
    );
    const title =
      cleanText(linkEl?.textContent) ||
      cleanText(card.querySelector('.job-card-list__title')?.textContent);
    if (!title || !url || seenUrls.has(url)) continue;
    seenUrls.add(url);

    const companyEl =
      card.querySelector('.job-card-container__primary-description') ||
      card.querySelector('.artdeco-entity-lockup__subtitle') ||
      card.querySelector('.base-search-card__subtitle') ||
      card.querySelector('.job-card-container__company-name') ||
      card.querySelector('.job-search-card__subtitle-link') ||
      card.querySelector('a[href*="/company/"]');
    const company = cleanText(companyEl?.textContent) || 'LinkedIn Company';

    const locEl =
      card.querySelector('.job-card-container__metadata-item') ||
      card.querySelector('.job-search-card__location');
    const location = cleanText(locEl?.textContent) || null;

    results.push({
      title,
      company,
      location,
      url,
      source: 'linkedin',
      description: '',
      postedAt: null,
    });
  }

  return results;
}

export function extractLinkedIn(doc) {
  const detail = extractLinkedInJobDetails(doc);
  if (detail && detail.description) {
    return [detail];
  }
  const cards = extractLinkedInSearchCards(doc);
  if (cards.length > 0) {
    return cards;
  }
  return detail ? [detail] : [];
}
