import { getConfig as readConfig } from './config.js';

export class ConfigError extends Error {}
export class AuthError extends Error {}
export class HttpError extends Error {
  constructor(status) {
    super(`ingest request failed with HTTP ${status}`);
    this.status = status;
  }
}
export class TimeoutError extends Error {}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function sendJobs({
  jobs,
  getConfig = readConfig,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  retries = 2,
  backoffMs = 500,
  sleep = defaultSleep,
}) {
  const config = await getConfig();
  const { serverUrl, apiKey } = config;
  if (!serverUrl) throw new ConfigError('serverUrl is not configured');
  if (!apiKey) throw new ConfigError('apiKey is not configured');

  const url = `${String(serverUrl).replace(/\/+$/, '')}/api/v1/jobs/ingest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await attempt();
  } finally {
    clearTimeout(timer);
  }

  async function attempt(tryCount = 0) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobs }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError')
        throw new TimeoutError(`request timed out after ${timeoutMs}ms`);
      throw err;
    }

    if (response.ok) return response.json();

    if (response.status === 401) {
      throw new AuthError('auth error: ingest server rejected the API key (401)');
    }

    if (response.status >= 500 && tryCount < retries) {
      await sleep(backoffMs * 2 ** tryCount);
      return attempt(tryCount + 1);
    }

    throw new HttpError(response.status);
  }
}
