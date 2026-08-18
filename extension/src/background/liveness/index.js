/**
 * liveness/index.js — zero-token liveness check for ATS-hosted postings.
 *
 * Ported from career-ops liveness-api.mjs (MIT, vendored; see
 * scripts/vendor.mjs) so liveness checking runs inside the extension, never on
 * the Phase 01 server (explicit project invariant). The ATS detection tables
 * (resolveAtsApi, classifyAshbyBoard) are copied verbatim — same hosts, same
 * SSRF-safe strict-charset validation, same fixed-host URL templates.
 *
 * Deviations:
 *   - Uses the extension's own transport (providers/_http.mjs) instead of a
 *     bare fetch: timeout + redirect refusal + retry semantics are identical
 *     to what the providers use.
 *   - Exposes checkLiveness(job, ctx) returning the canonical tri-state
 *     'active' | 'expired' | 'unknown' instead of the upstream
 *     checkLivenessViaApi(url) (which returns null = inconclusive). 'unknown'
 *     maps to null upstream — the caller decides whether to keep the job
 *     (Phase 03 keeps it: conservative by design, a false 'expired' costs the
 *     user a real posting, so only a definitive 404/410 expires).
 *
 * SSRF-safe by construction (unchanged from upstream): the request URL is
 * built from a FIXED, hard-coded API host plus path segments extracted from
 * the posting URL with a strict charset (no slashes/traversal), and server-
 * side redirects are refused.
 */

import { DEFAULT_USER_AGENT } from '../user-agent.mjs';
import { makeHttpCtx, fetchResponse } from '../providers/_http.mjs';

const TIMEOUT_MS = 8_000;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function isSafeValue(v) {
  if (typeof v !== 'string' || v.length === 0) return false;
  return v
    .split('/')
    .every((seg) => seg.length > 0 && SAFE_SEGMENT.test(seg) && !seg.includes('..'));
}

const ATS_PROVIDERS = [
  {
    id: 'greenhouse',
    match(u) {
      if (!/(^|\.)greenhouse\.io$/.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)\/?$/);
      return m ? { board: m[1], id: m[2] } : null;
    },
    api: ({ board, id }) => `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`,
  },
  {
    id: 'lever',
    match(u) {
      const host = u.hostname.match(/^jobs\.((?:eu\.)?lever\.co)$/);
      if (!host) return null;
      const m = u.pathname.match(/^\/([^/]+)\/([^/?#]+)\/?$/);
      return m ? { apiHost: `api.${host[1]}`, slug: m[1], id: m[2] } : null;
    },
    api: ({ apiHost, slug, id }) => `https://${apiHost}/v0/postings/${slug}/${id}`,
    api404Authoritative: false,
  },
  {
    id: 'ashby',
    match(u) {
      if (u.hostname !== 'jobs.ashbyhq.com') return null;
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)(?:\/application)?\/?$/);
      return m ? { org: m[1], jobId: m[2] } : null;
    },
    api: ({ org }) => `https://api.ashbyhq.com/posting-api/job-board/${org}`,
    timeoutMs: 20_000,
    async interpret(res, { jobId }) {
      let json;
      try {
        json = await res.json();
      } catch {
        return null;
      }
      return classifyAshbyBoard(json, jobId);
    },
  },
  {
    id: 'workday',
    match(u) {
      const m = `${u.hostname}${u.pathname}`.match(
        /^([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)\/job\/(.+?)\/?$/
      );
      if (!m) return null;
      const [, tenant, shard, site, jobPath] = m;
      return { tenant, shard, site, jobPath };
    },
    api: ({ tenant, shard, site, jobPath }) =>
      `https://${tenant}.${shard}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/job/${jobPath}`,
  },
];

/**
 * Decide liveness for one Ashby posting from its org's job-board API payload.
 * Pure + deterministic. (Copied verbatim from career-ops.)
 */
export function classifyAshbyBoard(json, jobId) {
  if (!json || !Array.isArray(json.jobs)) return null;
  const target = String(jobId).toLowerCase();
  const job = json.jobs.find((j) => typeof j?.id === 'string' && j.id.toLowerCase() === target);
  if (job && job.isListed !== false) {
    return {
      result: 'active',
      code: 'ashby_api_ok',
      reason: 'Ashby posting is listed on the board (live)',
    };
  }
  return {
    result: 'expired',
    code: 'ashby_api_unlisted',
    reason: 'Ashby posting not listed on the board — removed/unlisted',
  };
}

/**
 * Map a posting URL to its ATS API URL, or null if it isn't a known ATS
 * posting (or any extracted segment fails the strict charset). Pure.
 */
export function resolveAtsApi(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  for (const provider of ATS_PROVIDERS) {
    const parts = provider.match(u);
    if (!parts) continue;
    if (!Object.values(parts).every(isSafeValue)) return null;
    return {
      ats: provider.id,
      apiUrl: provider.api(parts),
      parts,
      timeoutMs: provider.timeoutMs,
      interpret: provider.interpret,
      api404Authoritative: provider.api404Authoritative !== false,
    };
  }
  return null;
}

/** True if `url` is an ATS posting we can check via API. */
export function isAtsPosting(url) {
  return resolveAtsApi(url) !== null;
}

/**
 * Zero-token liveness check via the posting's ATS API.
 *
 * @param {{url: string}} job - a posting (normalized or provider-shaped).
 * @param {object} [ctx] - transport context (defaults to makeHttpCtx()).
 * @returns {Promise<{result: 'active'|'expired', code: string, reason: string}|null>}
 *   null = not a known ATS posting, or inconclusive → caller keeps the job.
 */
export async function checkLivenessViaApi(job, ctx) {
  const url = job?.url;
  const resolved = resolveAtsApi(url);
  if (!resolved) return null;
  const { ats, apiUrl, parts, interpret, timeoutMs, api404Authoritative } = resolved;
  const httpCtx = ctx ?? makeHttpCtx();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || TIMEOUT_MS);
  const fetchOpts = {
    method: 'GET',
    headers: { 'user-agent': DEFAULT_USER_AGENT, accept: 'application/json' },
    signal: controller.signal,
  };
  try {
    let res;
    try {
      // Same redirect-refusal transport the providers use (see _http.mjs): a
      // 3xx is thrown as a non-retryable redirect error and classified
      // inconclusive here, never followed (SSRF + ambiguity guard).
      res = await (httpCtx.fetchResponse ?? fetchResponse)(apiUrl, fetchOpts);
    } catch {
      return null;
    }

    if (res.status === 404 || res.status === 410) {
      if (!api404Authoritative) return null;
      return {
        result: 'expired',
        code: `${ats}_api_gone`,
        reason: `ATS API ${res.status} — posting removed`,
      };
    }
    if (res.status === 200) {
      if (interpret) return await interpret(res, parts);
      return {
        result: 'active',
        code: `${ats}_api_ok`,
        reason: 'ATS API returns the posting (live)',
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Canonical tri-state liveness for the scan pipeline.
 *
 * @param {object} job - a posting (normalized or provider-shaped).
 * @param {object} [ctx] - transport context.
 * @returns {Promise<'active'|'expired'|'unknown'>}
 *   'expired' ONLY on a definitive 404/410 (or Ashby unlisted). Everything
 *   else — network, timeout, redirect, rate-limit, unparseable, non-ATS —
 *   is 'unknown': conservative by design, a false 'expired' costs a real job.
 */
export async function checkLiveness(job, ctx) {
  const verdict = await checkLivenessViaApi(job, ctx);
  return verdict?.result ?? 'unknown';
}
