/**
 * ats.js — Direct DOM extractors for major ATS platforms:
 * - Greenhouse (boards.greenhouse.io, job-boards.greenhouse.io)
 * - Lever (jobs.lever.co)
 * - Ashby (jobs.ashbyhq.com)
 * - Generic fallback extractor for any job posting page
 */

import { cleanText, getCanonicalUrl } from './helpers.js';

export function extractGreenhouse(doc) {
  if (!doc) return [];
  const titleEl =
    doc.querySelector('h1.app-title') ||
    doc.querySelector('h1.heading') ||
    doc.querySelector('.job-name') ||
    doc.querySelector('h1');
  const title = cleanText(titleEl?.textContent);
  if (!title) return [];

  const companyEl =
    doc.querySelector('.company-name') ||
    doc.querySelector('meta[property="og:site_name"]') ||
    doc.querySelector('.header__logo-text');
  let company = cleanText(companyEl?.textContent || companyEl?.getAttribute?.('content'));
  if (!company) {
    const parts = (doc.location?.pathname || '').split('/').filter(Boolean);
    company = parts[0] || 'Greenhouse Company';
  }

  const locEl =
    doc.querySelector('.location') ||
    doc.querySelector('.body--secondary') ||
    doc.querySelector('.job-location');
  const location = cleanText(locEl?.textContent) || null;

  const descEl =
    doc.querySelector('#content') ||
    doc.querySelector('#app_body') ||
    doc.querySelector('.job-description') ||
    doc.querySelector('#job-description') ||
    doc.querySelector('article');
  const description = cleanText(descEl?.textContent) || '';

  const url = getCanonicalUrl(doc) || doc.location?.href || '';

  return [
    {
      title,
      company,
      location,
      description,
      url,
      source: 'greenhouse',
      postedAt: null,
    },
  ];
}

export function extractLever(doc) {
  if (!doc) return [];
  const titleEl = doc.querySelector('.posting-headline h2') || doc.querySelector('h2') || doc.querySelector('h1');
  const title = cleanText(titleEl?.textContent);
  if (!title) return [];

  const companyEl = doc.querySelector('.main-header-logo') || doc.querySelector('meta[property="og:site_name"]');
  let company = cleanText(companyEl?.getAttribute?.('alt') || companyEl?.getAttribute?.('content'));
  if (!company) {
    const parts = (doc.location?.pathname || '').split('/').filter(Boolean);
    company = parts[0] || 'Lever Company';
  }

  const locEl = doc.querySelector('.posting-categories .location') || doc.querySelector('.sort-by-time');
  const location = cleanText(locEl?.textContent) || null;

  const descEl = doc.querySelector('.section-wrapper') || doc.querySelector('.posting-sections') || doc.querySelector('article');
  const description = cleanText(descEl?.textContent) || '';

  const url = getCanonicalUrl(doc) || doc.location?.href || '';

  return [
    {
      title,
      company,
      location,
      description,
      url,
      source: 'lever',
      postedAt: null,
    },
  ];
}

export function extractAshby(doc) {
  if (!doc) return [];
  const titleEl = doc.querySelector('h1') || doc.querySelector('h2');
  const title = cleanText(titleEl?.textContent);
  if (!title) return [];

  const companyEl = doc.querySelector('meta[property="og:site_name"]') || doc.querySelector('header h1');
  let company = cleanText(companyEl?.getAttribute?.('content') || companyEl?.textContent);
  if (!company) {
    const parts = (doc.location?.pathname || '').split('/').filter(Boolean);
    company = parts[0] || 'Ashby Company';
  }

  const descEl = doc.querySelector('article') || doc.querySelector('main') || doc.querySelector('.ashby-job-posting-description');
  const description = cleanText(descEl?.textContent) || '';

  const url = getCanonicalUrl(doc) || doc.location?.href || '';

  return [
    {
      title,
      company,
      location: null,
      description,
      url,
      source: 'ashby',
      postedAt: null,
    },
  ];
}

export function extractGenericJob(doc) {
  if (!doc) return [];
  const titleEl = doc.querySelector('h1') || doc.querySelector('h2');
  const title = cleanText(titleEl?.textContent);
  const descEl = doc.querySelector('article') || doc.querySelector('#job-description') || doc.querySelector('.job-description') || doc.querySelector('main');
  const description = cleanText(descEl?.textContent) || '';

  if (!title || description.length < 50) return [];

  return [
    {
      title,
      company: cleanText(doc.title?.split('-')[0]?.split('|')[0]) || 'Unknown Company',
      location: null,
      description,
      url: getCanonicalUrl(doc) || doc.location?.href || '',
      source: 'web',
      postedAt: null,
    },
  ];
}
