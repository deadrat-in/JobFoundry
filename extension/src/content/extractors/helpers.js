/**
 * helpers.js — DOM extraction utility functions ported from career-ops.
 */

import { decodeEntities } from '../../background/providers/_html-entities.mjs';

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

const BLOCK_END_RE = /<\/(p|div|ul|ol|h[1-6]|tr|section|article|blockquote)\s*>/gi;
const NON_CONTENT_RE =
  /<(script|style|nav|header|footer|noscript|svg|button|form|iframe|select|option)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/**
 * Description markup -> plain text, keeping block structure as newlines.
 * Lifted directly from career-ops browser-extract.mjs:jdHtmlToText.
 */
export function jdHtmlToText(html) {
  if (typeof html !== 'string' || !html) return '';
  const stripped = decodeEntities(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(BLOCK_END_RE, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Universal HTML decanter: strips navigation, chrome, headers, footers, forms,
 * and decodes clean readable body text for job postings.
 */
export function decantHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  const clean = html.replace(NON_CONTENT_RE, ' ');
  return jdHtmlToText(clean);
}

/**
 * Extract JobPosting Schema.org JSON-LD from document.
 * Provides the most accurate and un-obfuscated JD across modern job boards.
 */
export function extractJsonLd(doc) {
  if (!doc) return null;
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const content = script.textContent?.trim();
      if (!content) continue;
      const data = JSON.parse(content);
      const items = Array.isArray(data) ? data : data['@graph'] || [data];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const type = String(item['@type'] || '');
        if (type === 'JobPosting' || type.includes('JobPosting')) {
          const title = cleanText(item.title || item.name);
          let company = '';
          if (typeof item.hiringOrganization === 'string') {
            company = cleanText(item.hiringOrganization);
          } else if (item.hiringOrganization && typeof item.hiringOrganization === 'object') {
            company = cleanText(item.hiringOrganization.name || item.hiringOrganization.legalName);
          }

          let location = null;
          if (typeof item.jobLocation === 'string') {
            location = cleanText(item.jobLocation);
          } else if (item.jobLocation?.address) {
            const addr = item.jobLocation.address;
            if (typeof addr === 'string') location = cleanText(addr);
            else if (typeof addr === 'object') {
              location = cleanText(
                [addr.addressLocality, addr.addressRegion, addr.addressCountry]
                  .filter(Boolean)
                  .join(', ')
              );
            }
          }

          let description = '';
          if (item.description) {
            description = jdHtmlToText(item.description);
          }

          let postedAt = null;
          if (item.datePosted) {
            const parsed = Date.parse(item.datePosted);
            if (!Number.isNaN(parsed)) postedAt = parsed;
          }

          const url = item.url
            ? absolutizeUrl(item.url, doc.location?.href)
            : getCanonicalUrl(doc) || doc.location?.href || '';

          if (title) {
            return {
              title,
              company: company || 'Company',
              location: location || null,
              description: description || '',
              url,
              postedAt,
              source: 'json-ld',
            };
          }
        }
      }
    } catch {
      // Ignore non-matching or invalid JSON-LD blocks
    }
  }
  return null;
}

/**
 * Read semantic main text from the page: <main>, [role="main"], <article>, or body.
 * Strips navigation, headers, footers, scripts, and buttons.
 */
export function readSemanticDom(doc) {
  if (!doc) return { title: '', description: '', company: '' };

  const titleEl =
    doc.querySelector('h1') ||
    doc.querySelector('h2') ||
    doc.querySelector('[role="heading"][aria-level="1"]');
  const title = cleanText(titleEl?.textContent || doc.title?.split(/[-|–—]/)[0]);

  const root =
    doc.querySelector(
      'main, [role="main"], article, #content, #job-description, .job-description, .job-details'
    ) || doc.body;

  let description = '';
  if (root) {
    const clone = root.cloneNode(true);
    clone
      .querySelectorAll(
        'script, style, nav, header, footer, noscript, svg, button, form, iframe, [role="dialog"], [aria-hidden="true"]'
      )
      .forEach((el) => el.remove());
    description = jdHtmlToText(clone.innerHTML || clone.innerText || clone.textContent || '');
  }

  const ogCompany = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
  const titleCompany = doc.title?.split(/[-|–—]/)[1];
  const hostCompany = doc.location?.hostname?.split('.')[0];
  const company = cleanText(ogCompany || titleCompany || hostCompany || 'Company');

  return { title, description, company };
}

/**
 * Expand collapsed or truncated job description sections by clicking known 'Show more' buttons.
 * Safe no-op if buttons are missing or in non-DOM test environments.
 * @param {Document} doc
 */
export function expandTruncatedContent(doc) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return;

  const selectors = [
    'button.show-more-less-html__button--more',
    'button[data-tracking-control-name*="show-more"]',
    '.jobs-description__footer-button',
    'button[data-testid="view-job-details"]',
    'button#viewJobDetailsButton',
    'button[data-test="show-more"]',
    'button.css-15g7vfa',
    'button[aria-label*="Show more" i]',
    'button[aria-label*="Read more" i]',
    'button[aria-label*="View full" i]',
    'button.read-more',
    'span.show-more-less-html__button--more',
  ];

  for (const selector of selectors) {
    try {
      const buttons = doc.querySelectorAll(selector);
      for (const btn of buttons) {
        if (typeof btn.click === 'function') {
          btn.click();
        }
      }
    } catch {
      // Safe to ignore selector or click failures
    }
  }
}

/**
 * Checks if a job description appears truncated or incomplete.
 * @param {string} text
 * @returns {boolean}
 */
export function isDescriptionIncomplete(text) {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (trimmed.length < 250) return true;

  // Check for common truncation signals at the end
  const truncationRegex = /(\.\.\.|…)\s*(see more|read more|view more)?\s*$/i;
  const readMoreSuffix = /\b(see more|read more)\s*$/i;
  return truncationRegex.test(trimmed) || readMoreSuffix.test(trimmed);
}

/**
 * Strips common corporate boilerplate, EEOC statements, and legal disclaimers.
 * @param {string} text
 * @returns {string}
 */
export function cleanBoilerplate(text) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text
    // EEO / Affirmative Action paragraphs
    .replace(
      /(?:we are an\s+)?equal opportunity employer[\s\S]*?(?=\n\n|\n(?=[A-Z0-9#*-])|$)/gi,
      ''
    )
    .replace(
      /(?:all qualified applicants will receive consideration[\s\S]*?)(?=\n\n|\n(?=[A-Z0-9#*-])|$)/gi,
      ''
    )
    .replace(
      /(?:we participate in e-verify[\s\S]*?)(?=\n\n|\n(?=[A-Z0-9#*-])|$)/gi,
      ''
    )
    .replace(
      /(?:affirmative action\s+(?:employer|policy)[\s\S]*?)(?=\n\n|\n(?=[A-Z0-9#*-])|$)/gi,
      ''
    )
    // Cookie / privacy footer remnants
    .replace(
      /(?:by clicking (?:apply|submit|continue), you agree to our terms[\s\S]*?)(?=\n\n|$)/gi,
      ''
    )
    // Normalize excessive newlines and whitespace
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned || text.trim();
}
