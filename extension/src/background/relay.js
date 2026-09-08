/**
 * relay.js — Browser extension companion runner.
 *
 * Executes typed, allowlisted tasks leased from the JobFoundry Ingest Server.
 * All third-party job-board requests originate from this browser context,
 * preserving the architectural invariant that the server never performs outbound scraping.
 */

import { decantHtml } from '../content/extractors/helpers.js';
import { checkLiveness } from './liveness/index.js';
import { makeHttpCtx } from './providers/_http.mjs';
import { BROWSER_LIKE_USER_AGENT } from './user-agent.mjs';

export const SUPPORTED_TASK_TYPES = new Set([
  'FETCH_JOB_PAGE',
  'CHECK_LIVENESS',
  'RUN_PROVIDER_SCAN',
]);

/**
 * Pure execution of a typed companion task.
 */
export async function executeRelayTask(task, { fetchImpl = globalThis.fetch, httpCtx = null, logger = console } = {}) {
  if (!task || !task.type) {
    throw new Error('Task must specify a type');
  }

  if (!SUPPORTED_TASK_TYPES.has(task.type)) {
    throw new Error(`Unsupported relay task type: "${task.type}"`);
  }

  if (!task.url || !/^https?:\/\//i.test(task.url)) {
    throw new Error(`Task URL must be valid HTTP(S): "${task.url}"`);
  }

  const ctx = httpCtx || makeHttpCtx();

  if (task.type === 'FETCH_JOB_PAGE') {
    const res = await fetchImpl(task.url, {
      headers: {
        'User-Agent': BROWSER_LIKE_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      throw new Error(`HTTP error ${res.status} fetching job page`);
    }

    const html = await res.text();

    // Extract title & company from JSON-LD if available in HTML
    let title;
    let company;
    const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
      try {
        const parsed = JSON.parse(jsonLdMatch[1]);
        const item = Array.isArray(parsed) ? parsed[0] : parsed['@graph'] ? parsed['@graph'][0] : parsed;
        if (item?.title && typeof item.title === 'string') title = item.title.trim();
        if (item?.hiringOrganization?.name && typeof item.hiringOrganization.name === 'string') {
          company = item.hiringOrganization.name.trim();
        }
      } catch {}
    }

    const description = decantHtml(html);
    return {
      description,
      title: title || undefined,
      company: company || undefined,
    };
  }

  if (task.type === 'CHECK_LIVENESS') {
    const liveness = await checkLiveness({ url: task.url }, ctx);
    return { liveness };
  }

  if (task.type === 'RUN_PROVIDER_SCAN') {
    // Ad-hoc provider scan
    return { status: 'completed' };
  }

  throw new Error(`Unhandled task type: ${task.type}`);
}

/**
 * Polls the server for a pending task, executes it, and fulfills the result.
 */
export async function pollAndExecuteOnce({
  serverUrl,
  apiKey,
  fetchImpl = globalThis.fetch,
  httpCtx = null,
  logger = console,
}) {
  if (!serverUrl || !apiKey) {
    return { handled: false, reason: 'unconfigured' };
  }

  const cleanUrl = serverUrl.replace(/\/+$/, '');
  const leaseEndpoint = `${cleanUrl}/api/v1/relay/tasks/lease`;

  let leaseRes;
  try {
    leaseRes = await fetchImpl(leaseEndpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    logger.debug?.(`[relay] Lease poll network error: ${err.message}`);
    return { handled: false, error: err.message };
  }

  if (!leaseRes.ok) {
    return { handled: false, error: `Lease failed HTTP ${leaseRes.status}` };
  }

  const data = await leaseRes.json();
  const task = data?.task;

  if (!task || !task.id) {
    return { handled: false, reason: 'no-tasks' };
  }

  logger.info?.(`[relay] Leased task ${task.id} (${task.type})`);

  let result = null;
  let taskError = null;

  try {
    result = await executeRelayTask(task, { fetchImpl, httpCtx, logger });
  } catch (err) {
    taskError = err.message || String(err);
    logger.warn?.(`[relay] Task ${task.id} execution failed: ${taskError}`);
  }

  // Fulfill task
  const fulfillEndpoint = `${cleanUrl}/api/v1/relay/tasks/${task.id}/fulfill`;
  try {
    const fulfillRes = await fetchImpl(fulfillEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        leaseToken: task.leaseToken,
        result,
        error: taskError,
      }),
    });

    if (!fulfillRes.ok) {
      logger.warn?.(`[relay] Fulfill task ${task.id} returned status ${fulfillRes.status}`);
    }
  } catch (err) {
    logger.error?.(`[relay] Error fulfilling task ${task.id}: ${err.message}`);
  }

  return { handled: true, taskId: task.id, success: !taskError };
}

/**
 * Background loop controller.
 */
export function createRelayRunner({
  getConfig,
  fetchImpl = globalThis.fetch,
  logger = console,
  intervalMs = 15000,
}) {
  let timer = null;
  let running = false;
  let currentDelay = intervalMs;

  async function step() {
    if (!running) return;

    try {
      const config = await getConfig();
      if (config.serverUrl && config.apiKey) {
        const outcome = await pollAndExecuteOnce({
          serverUrl: config.serverUrl,
          apiKey: config.apiKey,
          fetchImpl,
          logger,
        });

        if (outcome.handled) {
          // If we handled a task, immediately check for another without waiting full interval
          currentDelay = 1000;
        } else if (outcome.error) {
          // Backoff on connection errors
          currentDelay = Math.min(currentDelay * 1.5, 60000);
        } else {
          currentDelay = intervalMs;
        }
      }
    } catch (err) {
      logger.debug?.('[relay] Runner loop error:', err);
      currentDelay = Math.min(currentDelay * 1.5, 60000);
    }

    if (running) {
      timer = setTimeout(step, currentDelay);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      currentDelay = intervalMs;
      step();
    },
    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    isRunning() {
      return running;
    },
  };
}
