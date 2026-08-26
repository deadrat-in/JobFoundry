/**
 * title-keywords.js — Title matching engine for JobFoundry extension.
 * Ported directly from career-ops/title-keywords.mjs (MIT).
 */

export const WORD_PREFIX = 'word:';
export const STEM_PREFIX = 'stem:';

function escapeForRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WORD_CHAR = String.raw`[\p{L}\p{M}\p{N}_]`;
const anchoredPattern = (body) => new RegExp(`(?<!${WORD_CHAR})${body}(?!${WORD_CHAR})`, 'u');
const stemPattern = (body) => new RegExp(`(?<!${WORD_CHAR})${body}`, 'u');

/**
 * Compile a lowercased keyword into a matcher predicate.
 *
 * Short all-letter acronyms (2-3 chars: cfo, coo, sdr, bdr, gsi, ai, ml…) match
 * on WORD BOUNDARIES so "AI" does not match "Maintenance".
 * A `word:` prefix asks for whole-word treatment explicitly.
 * A `stem:` prefix asks for prefix-stem matching.
 * Multi-word phrases and symbols keep fast, permissive substring matching.
 *
 * @param {string} kw - already trimmed and lowercased.
 * @returns {(lower: string) => boolean}
 */
export function compileKeyword(kw) {
  const normKw = (kw || '').trim().toLowerCase();
  if (normKw.startsWith(WORD_PREFIX)) {
    const bare = normKw.slice(WORD_PREFIX.length).trim();
    if (!bare) return () => false;
    const re = anchoredPattern(escapeForRegExp(bare));
    return (val) => re.test(String(val || '').toLowerCase());
  }
  if (normKw.startsWith(STEM_PREFIX)) {
    const bare = normKw.slice(STEM_PREFIX.length).trim();
    if (!bare) return () => false;
    const re = stemPattern(escapeForRegExp(bare));
    return (val) => re.test(String(val || '').toLowerCase());
  }
  if (/^[a-z]{2,3}$/.test(normKw)) {
    const re = anchoredPattern(normKw);
    return (val) => re.test(String(val || '').toLowerCase());
  }
  return (val) => String(val || '').toLowerCase().includes(normKw);
}

/**
 * Compile a positive keyword: supports " + " to require several terms in any order.
 * E.g., "director + engineering" matches "Director of Engineering".
 *
 * @param {string} kw - keyword string.
 * @returns {(title: string) => boolean}
 */
export function compilePositiveKeyword(kw) {
  const normKw = (kw || '').trim().toLowerCase();
  if (normKw.includes(' + ')) {
    const parts = normKw
      .split(' + ')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return () => false;
    const matchers = parts.map(compileKeyword);
    return (val) => {
      const lower = String(val || '').toLowerCase();
      return matchers.every((m) => m(lower));
    };
  }
  return compileKeyword(normKw);
}

/**
 * Build a filter predicate from a titleFilter configuration object:
 * `{ positive?: string[], negative?: string[] }`
 *
 * Rule:
 * - If positive is empty/absent: passes (unless negative matches).
 * - If positive is non-empty: AT LEAST ONE positive must match.
 * - If negative is non-empty: ZERO negatives must match.
 *
 * @param {{ positive?: string[], negative?: string[] }} [titleFilter]
 * @returns {(title: string) => boolean}
 */
export function buildTitleFilter(titleFilter) {
  if (!titleFilter || typeof titleFilter !== 'object') {
    return () => true;
  }

  const posRaw = Array.isArray(titleFilter.positive) ? titleFilter.positive : [];
  const negRaw = Array.isArray(titleFilter.negative) ? titleFilter.negative : [];

  const posMatchers = posRaw
    .filter((k) => typeof k === 'string' && k.trim().length > 0)
    .map((k) => compilePositiveKeyword(k.trim().toLowerCase()));

  const negMatchers = negRaw
    .filter((k) => typeof k === 'string' && k.trim().length > 0)
    .map((k) => compileKeyword(k.trim().toLowerCase()));

  return function matchesTitle(title) {
    if (!title || typeof title !== 'string') return false;
    const lower = title.trim().toLowerCase();

    // Check negative exclusions first
    for (const matchNeg of negMatchers) {
      if (matchNeg(lower)) {
        return false;
      }
    }

    // If no positive filter defined, all non-negative titles pass
    if (posMatchers.length === 0) {
      return true;
    }

    // At least one positive must match
    for (const matchPos of posMatchers) {
      if (matchPos(lower)) {
        return true;
      }
    }

    return false;
  };
}
