// @ts-check
/**
 * decant.mjs — Universal Job Description Decanter.
 *
 * Extracts clean, readable plain-text markdown descriptions from raw HTML or job URLs:
 *   Tier 1: Schema.org JobPosting JSON-LD (structured description).
 *   Tier 2: Semantic job posting containers (<article>, <main>, .job-description).
 *   Tier 3: Full DOM Decanter: strips non-content chrome (nav, header, footer,
 *           scripts, forms, dialogs) and converts block elements to structured plain text.
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  bull: '•',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
};

/**
 * Decode HTML entities (named & numeric).
 * @param {string} text
 * @returns {string}
 */
export function decodeHtmlEntities(text) {
  if (typeof text !== 'string' || !text) return '';
  return text
    .replace(/&([a-zA-Z]+);/g, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_, code) => {
      const num = parseInt(code, 10);
      return Number.isFinite(num) && num > 0 && num < 0x10ffff
        ? String.fromCodePoint(num)
        : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const num = parseInt(hex, 16);
      return Number.isFinite(num) && num > 0 && num < 0x10ffff
        ? String.fromCodePoint(num)
        : _;
    });
}

const BLOCK_END_RE = /<\/(p|div|ul|ol|h[1-6]|tr|section|article|blockquote)\s*>/gi;
const NON_CONTENT_RE = /<(script|style|nav|header|footer|noscript|svg|button|form|iframe|select|option)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DIALOG_RE = /<[^>]+(?:role=["']dialog["']|aria-hidden=["']true["'])[^>]*>[\s\S]*?<\/[^>]+>/gi;

/**
 * Strips HTML tags and normalizes block structure to structured text.
 * @param {string} html
 * @returns {string}
 */
export function markupToText(html) {
  if (typeof html !== 'string' || !html) return '';
  const stripped = decodeHtmlEntities(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(BLOCK_END_RE, '\n')
    .replace(/<[^>]+>/g, ' ');

  return decodeHtmlEntities(stripped)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Universal HTML decanter: Extracts clean job description text from an HTML document.
 * @param {string} html - Raw HTML of the job posting page.
 * @returns {string} Decanted plain-text description.
 */
export function decantHtml(html) {
  if (typeof html !== 'string' || !html) return '';

  // Tier 1: Schema.org JobPosting JSON-LD
  const jsonLdMatch = html.match(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  if (jsonLdMatch) {
    for (const scriptTag of jsonLdMatch) {
      try {
        const inner = scriptTag.replace(/^<script\b[^>]*>|<\/script>$/gi, '').trim();
        const data = JSON.parse(inner);
        const items = Array.isArray(data) ? data : data['@graph'] || [data];
        for (const item of items) {
          if (
            item &&
            (item['@type'] === 'JobPosting' ||
              String(item['@type'] || '').includes('JobPosting')) &&
            item.description
          ) {
            const parsed = markupToText(String(item.description));
            if (parsed.length > 50) return parsed;
          }
        }
      } catch {
        // Ignore invalid JSON-LD
      }
    }
  }

  // Tier 2: Semantic job description containers
  const semanticMatch =
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
    html.match(
      /<div\b[^>]*class=["'][^"']*(?:job-description|jobDescription|jobDetails|description)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
    ) ||
    html.match(
      /<div\b[^>]*id=["'][^"']*(?:job-description|jobDescription|jobDetails|description)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
    );

  if (semanticMatch && semanticMatch[1]) {
    const text = markupToText(semanticMatch[1].replace(NON_CONTENT_RE, ' '));
    if (text.length > 50) return text;
  }

  // Tier 3: Universal DOM Decanter fallback (strip chrome, nav, footer, forms, scripts)
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const contentHtml = bodyMatch ? bodyMatch[1] : html;
  const clean = contentHtml.replace(NON_CONTENT_RE, ' ').replace(DIALOG_RE, ' ');
  return markupToText(clean);
}

/**
 * Fetches a URL and decants the job description from the page content.
 * @param {string} url - Target URL.
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function fetchAndDecantUrl(url, { timeoutMs = 8000 } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!res.ok) return '';
    const html = await res.text();
    return decantHtml(html);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}
