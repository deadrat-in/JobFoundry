// _http.mjs — HTTP transport helpers shared across providers (browser port).
// Files prefixed with _ are never loaded as providers by the registry.
//
// Browser port of career-ops providers/_http.mjs (MIT, vendored; see
// scripts/vendor.mjs). Deviations from upstream (each documented):
//   - _dns-cache.mjs is NOT imported. Upstream patches node:dns at import time
//     to memoize resolver lookups; a browser owns its own DNS, so this is an
//     intentional no-op here (nothing to patch, nothing cached).
//   - The transport never follows a server-side redirect. Upstream relied on
//     every provider passing redirect:'error' and on undici's "unexpected
//     redirect" TypeError to refuse redirects. Browsers do not expose that
//     exact error shape, so fetchWithTimeout pins redirect:'manual' and throws
//     the same pinned shape itself whenever a 3xx/opaqueredirect arrives. That
//     is the SSRF trust guard: a redirect to any host (trusted or not) is
//     refused, so a job-board server can never bounce the request to an
//     internal address. isRetryableError() classifies the pinned shape as
//     non-retryable exactly like the undici shape upstream pins.
//   - The abort timer covers the fetch + body read via a manual opaqueredirect
//     guard; browsers can't abort an in-flight response.body stream with the
//     request signal, so a stalled body is bounded only by the provider-level
//     timeout. Keep bodies small; this matches the list-API usage.
//
// Public API (unchanged): fetchJson, fetchText, fetchResponse, sleep,
// parseRetryAfterMs, isRetryableError, fetchJsonWithRetry, fetchTextWithRetry,
// makeHttpCtx, BROWSER_LIKE_USER_AGENT.

import { DEFAULT_USER_AGENT, BROWSER_LIKE_USER_AGENT } from '../user-agent.mjs';

export { BROWSER_LIKE_USER_AGENT };

const DEFAULT_TIMEOUT_MS = 10_000;

/** Actual HTTP redirect statuses (NOT 304 Not Modified, which is a cache
 * signal, not a redirect — 304 must survive to the caller as a null-body
 * response). */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** True when a fetch response is a redirect the transport refused to follow. */
function isRedirectResponse(res) {
  if (!res) return false;
  if (typeof res.status === 'number' && REDIRECT_STATUSES.has(res.status)) return true;
  return res.type === 'opaqueredirect';
}

/**
 * Build the pinned redirect-refusal error. Mirrors the shape undici produces
 * for redirect:'error' (REDIRECT_REFUSAL_CAUSE_MESSAGE below) so
 * isRetryableError() treats it as non-retryable, plus .status/.location when
 * the response actually exposed them (Node / mocked fetch), so callers that
 * distinguish redirects (jobvite's NoJobs.htm vs a retired tenant) still can.
 */
function redirectRefusal(res) {
  const err = Object.assign(new TypeError('fetch failed'), {
    cause: { message: 'unexpected redirect' },
  });
  if (typeof res?.status === 'number' && res.status >= 300 && res.status < 400) err.status = res.status;
  if (res?.headers && typeof res.headers.get === 'function') err.location = res.headers.get('location');
  return err;
}

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

async function fetchWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, method = 'GET', body = null } = {}, consume, allowEmptyBody = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // redirect:'manual' + the 3xx guard below = the SSRF trust guard. Never
    // 'follow' (a hostile server could bounce us to an internal address) and
    // never 'error' (browser TypeError shape is indistinguishable from a
    // network failure, which would be retried forever). 'manual' lets us throw
    // the pinned, non-retryable shape instead.
    const res = await fetch(url, {
      method,
      headers: { 'user-agent': DEFAULT_USER_AGENT, ...headers },
      body,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (isRedirectResponse(res)) throw redirectRefusal(res);
    if (!res.ok && !(allowEmptyBody && NULL_BODY_STATUSES.has(res.status))) {
      const responseText = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
      err.status = res.status;
      err.body = responseText;
      err.retryAfter = res.headers.get('retry-after');
      err.location = res.headers.get('location');
      throw err;
    }
    // Body consumption must stay inside the timer window: a server that sends
    // headers and then stalls the body otherwise hangs the caller forever.
    return await consume(res);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, opts = {}) {
  return fetchWithTimeout(url, opts, (res) => res.json());
}

export async function fetchText(url, opts = {}) {
  return fetchWithTimeout(url, opts, (res) => res.text());
}

// Returns a Response (after the timeout + non-2xx + redirect guard) so
// providers that need response headers — csod.mjs reads Set-Cookie to prime
// the session its search API requires — can route through ctx instead of
// re-implementing fetch. 204/205/304 (null-body statuses) survive the ok-guard
// because for a headers-only read those are valid signals, not errors.
export async function fetchResponse(url, opts = {}) {
  return await fetchWithTimeout(url, opts, async (res) => {
    const body = NULL_BODY_STATUSES.has(res.status) ? null : await res.text();
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  }, true);
}

/** Jitter added to a backoff so concurrent retries don't re-collide in lockstep. */
const JITTER_MS = 250;

/**
 * Retry policy shared by providers that paginate a large board.
 * Two retries = three total attempts. Not every provider wants this cadence —
 * workday.mjs and oraclecloud.mjs pass `{ retries: 3 }` explicitly.
 */
const RETRY_DEFAULTS = { retries: 2, baseDelayMs: 500, maxDelayMs: 8_000 };

/**
 * undici's `err.cause.message` for a `fetch(url, { redirect: 'error' })` that
 * met a 3xx — the shape every provider's mandatory SSRF guard produces on a
 * refused redirect. Pinned here (and by tests/providers/_http.test.mjs) so a
 * future Node/undici bump that changes the wording fails loudly. The browser
 * port's own redirectRefusal() emits this same cause message.
 */
const REDIRECT_REFUSAL_CAUSE_MESSAGE = 'unexpected redirect';

/** Awaitable sleep that honours a ctx-supplied clock, so tests never wall-clock wait. */
export function sleep(ms, ctx) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Milliseconds from a Retry-After header, in either permitted form (delta
 * seconds or an HTTP-date). Null when absent or unparseable.
 */
export function parseRetryAfterMs(value) {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
}

/**
 * Whether a failed request is worth retrying: 429, any 5xx, or a transport
 * error (no status — timeout/abort/DNS). A 4xx other than 429 is the server
 * telling us the request itself is wrong, and retrying it just burns time.
 *
 * A refused redirect (a 3xx under redirect:'manual', or undici's redirect:
 * 'error' TypeError) is deterministic and will never succeed on retry — see
 * REDIRECT_REFUSAL_CAUSE_MESSAGE.
 */
export function isRetryableError(err) {
  const status = err?.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (status === undefined && err instanceof TypeError && err?.cause?.message === REDIRECT_REFUSAL_CAUSE_MESSAGE) return false;
  return status === undefined; // network error / timeout / abort — no status set
}

/**
 * Bounded retry on transient failures, around any request.
 *
 * Shared by every provider that retries a fetch (a16z-speedrun-talent.mjs,
 * workday.mjs, oraclecloud.mjs, each via its own `policy` override) so all of
 * them get the same mature semantics — exponential backoff, jitter, and a
 * Retry-After that is honoured but CLAMPED so a hostile or misconfigured
 * `Retry-After: 86400` cannot stall a sweep — instead of each one
 * re-deriving them independently.
 *
 * Deliberately does NOT decide what happens when retries are exhausted: it
 * rethrows, and the caller chooses. The rethrown error carries `.attempts`
 * so a caller logging a summary doesn't have to assume the full `retries + 1`.
 *
 * @param {() => Promise<any>} request - Performs one attempt.
 * @param {{sleep?: Function}} ctx - Transport context (may supply a test clock).
 * @param {{retries?: number, baseDelayMs?: number, maxDelayMs?: number}} [policy]
 */
async function withRetry(request, ctx, policy = {}) {
  const { retries, baseDelayMs, maxDelayMs } = { ...RETRY_DEFAULTS, ...policy };
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await request();
    } catch (err) {
      lastErr = err;
      if (err !== null && (typeof err === 'object' || typeof err === 'function')) err.attempts = attempt + 1;
      if (attempt === retries || !isRetryableError(err)) throw err;
      const jitterMs = Math.min(JITTER_MS, Math.max(0, maxDelayMs));
      const ceiling = Math.max(0, maxDelayMs - jitterMs);
      const backoff = Math.min(baseDelayMs * 2 ** attempt, ceiling);
      const retryAfterMs = parseRetryAfterMs(err?.retryAfter);
      const delayMs = retryAfterMs !== null
        ? Math.min(retryAfterMs, maxDelayMs * 4)
        : backoff + Math.random() * jitterMs;
      await sleep(delayMs, ctx);
    }
  }
  throw lastErr;
}

/** Fetch JSON with bounded retry on transient failures. */
export async function fetchJsonWithRetry(ctx, url, opts = {}, policy = {}) {
  return withRetry(() => ctx.fetchJson(url, opts), ctx, policy);
}

/** Fetch text with bounded retry on transient failures. Same policy as the JSON form. */
export async function fetchTextWithRetry(ctx, url, opts = {}, policy = {}) {
  return withRetry(() => ctx.fetchText(url, opts), ctx, policy);
}

export function makeHttpCtx() {
  return {
    transport: 'http',
    fetchJson,
    fetchText,
    fetchResponse,
  };
}