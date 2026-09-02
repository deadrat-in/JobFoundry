/**
 * ats.js — Direct DOM extractors for major ATS platforms:
 * - Greenhouse (boards.greenhouse.io, job-boards.greenhouse.io)
 * - Lever (jobs.lever.co)
 * - Ashby (jobs.ashbyhq.com)
 * - Generic fallback extractor for any job posting page
 */

import {
  cleanText,
  getCanonicalUrl,
  extractJsonLd,
  jdHtmlToText,
  readSemanticDom,
  expandTruncatedContent,
  isDescriptionIncomplete,
  cleanBoilerplate,
} from './helpers.js';

export function extractGreenhouse(doc) {
  if (!doc) return [];

  expandTruncatedContent(doc);

  const jsonLd = extractJsonLd(doc);
  if (jsonLd && jsonLd.description && !isDescriptionIncomplete(jsonLd.description)) {
    return [{ ...jsonLd, description: cleanBoilerplate(jsonLd.description), source: 'greenhouse' }];
  }

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
  let description = descEl ? jdHtmlToText(descEl.innerHTML || descEl.textContent || '') : '';

  if (isDescriptionIncomplete(description) && jsonLd?.description) {
    description = jsonLd.description;
  }
  if (isDescriptionIncomplete(description)) {
    const semantic = readSemanticDom(doc);
    if (semantic.description && semantic.description.length > description.length) {
      description = semantic.description;
    }
  }

  description = cleanBoilerplate(description);

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

  expandTruncatedContent(doc);

  const jsonLd = extractJsonLd(doc);
  if (jsonLd && jsonLd.description && !isDescriptionIncomplete(jsonLd.description)) {
    return [{ ...jsonLd, description: cleanBoilerplate(jsonLd.description), source: 'lever' }];
  }

  const titleEl =
    doc.querySelector('.posting-headline h2') || doc.querySelector('h2') || doc.querySelector('h1');
  const title = cleanText(titleEl?.textContent);
  if (!title) return [];

  const companyEl =
    doc.querySelector('.main-header-logo') || doc.querySelector('meta[property="og:site_name"]');
  let company = cleanText(companyEl?.getAttribute?.('alt') || companyEl?.getAttribute?.('content'));
  if (!company) {
    const parts = (doc.location?.pathname || '').split('/').filter(Boolean);
    company = parts[0] || 'Lever Company';
  }

  const locEl =
    doc.querySelector('.posting-categories .location') || doc.querySelector('.sort-by-time');
  const location = cleanText(locEl?.textContent) || null;

  const descEl =
    doc.querySelector('.section-wrapper') ||
    doc.querySelector('.posting-sections') ||
    doc.querySelector('article');
  let description = descEl ? jdHtmlToText(descEl.innerHTML || descEl.textContent || '') : '';

  if (isDescriptionIncomplete(description) && jsonLd?.description) {
    description = jsonLd.description;
  }
  if (isDescriptionIncomplete(description)) {
    const semantic = readSemanticDom(doc);
    if (semantic.description && semantic.description.length > description.length) {
      description = semantic.description;
    }
  }

  description = cleanBoilerplate(description);

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

  expandTruncatedContent(doc);

  const jsonLd = extractJsonLd(doc);
  if (jsonLd && jsonLd.description && !isDescriptionIncomplete(jsonLd.description)) {
    return [{ ...jsonLd, description: cleanBoilerplate(jsonLd.description), source: 'ashby' }];
  }

  const titleEl = doc.querySelector('h1') || doc.querySelector('h2');
  const title = cleanText(titleEl?.textContent);
  if (!title) return [];

  const companyEl =
    doc.querySelector('meta[property="og:site_name"]') || doc.querySelector('header h1');
  let company = cleanText(companyEl?.getAttribute?.('content') || companyEl?.textContent);
  if (!company) {
    const parts = (doc.location?.pathname || '').split('/').filter(Boolean);
    company = parts[0] || 'Ashby Company';
  }

  const descEl =
    doc.querySelector('article') ||
    doc.querySelector('main') ||
    doc.querySelector('.ashby-job-posting-description') ||
    doc.querySelector('#job-description');
  let description = descEl ? jdHtmlToText(descEl.innerHTML || descEl.textContent || '') : '';

  if (isDescriptionIncomplete(description) && jsonLd?.description) {
    description = jsonLd.description;
  }
  if (isDescriptionIncomplete(description)) {
    const semantic = readSemanticDom(doc);
    if (semantic.description && semantic.description.length > description.length) {
      description = semantic.description;
    }
  }

  description = cleanBoilerplate(description);

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

  expandTruncatedContent(doc);

  // Tier 1: JSON-LD Schema.org
  const jsonLd = extractJsonLd(doc);
  if (jsonLd && jsonLd.description && !isDescriptionIncomplete(jsonLd.description)) {
    return [{ ...jsonLd, description: cleanBoilerplate(jsonLd.description), source: 'web' }];
  }

  // Tier 2: Semantic DOM Extraction (career-ops readDom)
  const { title, description, company } = readSemanticDom(doc);
  if (!title || description.length < 50) return [];

  return [
    {
      title,
      company: company || 'Company',
      location: null,
      description: cleanBoilerplate(description),
      url: getCanonicalUrl(doc) || doc.location?.href || '',
      source: 'web',
      postedAt: null,
    },
  ];
}
