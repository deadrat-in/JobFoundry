import { getConfig as readConfig } from '../shared/config.js';
import { sendJobs as ingestSendJobs } from '../shared/ingest-client.js';
import { ensureScanAlarm, SCAN_ALARM_NAME } from './alarms.js';
import { runScanPipeline } from './scan.js';
import { checkLiveness } from './liveness/index.js';
import { normalizeJob, withFingerprint } from './normalize.js';
import { fingerprintText } from './fingerprint.js';
import { dedupJobs, createSessionCache } from './dedup.js';
import { makeHttpCtx } from './providers/_http.mjs';

const defaultRunScan = async () =>
  runScanPipeline({ getConfig: readConfig, sendJobs: ingestSendJobs });

export async function processDiscoveredJobs({
  rawJobs,
  getConfig = readConfig,
  sendJobs = ingestSendJobs,
  liveness = checkLiveness,
  fingerprint = fingerprintText,
  cache = null,
  now = Date.now,
  logger = console,
} = {}) {
  if (!Array.isArray(rawJobs) || rawJobs.length === 0) {
    return { ok: true, ingested: 0 };
  }

  const config = await getConfig();
  if (!config.serverUrl || !config.apiKey) {
    return { ok: false, error: 'extension not configured with serverUrl and apiKey' };
  }

  const httpCtx = makeHttpCtx();
  const dedupCache = cache ?? createSessionCache();
  const survivors = [];

  for (const raw of rawJobs) {
    try {
      const livenessResult = await liveness(raw, httpCtx);
      if (livenessResult === 'expired') continue;
      const normalized = normalizeJob(raw, raw.source || 'content-script');
      const withFp = await withFingerprint(normalized, fingerprint);
      survivors.push(withFp);
    } catch (err) {
      logger.warn?.(`[content-ingest] skipping malformed job: ${err?.message ?? err}`);
    }
  }

  const deduped = await dedupJobs(survivors, dedupCache, { now: now() });
  if (deduped.length > 0 && sendJobs) {
    await sendJobs({
      serverUrl: config.serverUrl,
      apiKey: config.apiKey,
      jobs: deduped,
    });
  }

  return { ok: true, ingested: deduped.length };
}

export function createBackground({
  browser,
  runScan = defaultRunScan,
  getConfig = readConfig,
  sendJobs = ingestSendJobs,
  liveness = checkLiveness,
  fingerprint = fingerprintText,
  cache = null,
}) {
  const api = browser;
  if (!api) throw new Error('browser API unavailable');
  // When the caller injects getConfig but keeps the default runScan, the
  // default pipeline must read that same config (tests inject a storage-mock
  // getConfig so the pipeline can run without a browser global).
  const effectiveRunScan =
    runScan === defaultRunScan ? async () => runScanPipeline({ getConfig, sendJobs }) : runScan;

  const onInstalled = async () => {
    const config = await getConfig();
    await ensureScanAlarm({
      scanIntervalHours: config.scanIntervalHours,
      alarms: api.alarms,
    });
  };

  const onAlarm = async (alarm) => {
    if (alarm?.name === SCAN_ALARM_NAME) {
      await effectiveRunScan();
    }
  };

  const onMessage = (message) => {
    if (message?.type === 'popup:scanNow') {
      return (async () => {
        try {
          const jobs = await effectiveRunScan();
          return { ok: true, scanned: Array.isArray(jobs) ? jobs.length : 0 };
        } catch (err) {
          return { ok: false, error: err?.message ?? String(err) };
        }
      })();
    }

    if (message?.type === 'content:jobsDiscovered') {
      return (async () => {
        try {
          return await processDiscoveredJobs({
            rawJobs: message.jobs,
            getConfig,
            sendJobs,
            liveness,
            fingerprint,
            cache,
          });
        } catch (err) {
          return { ok: false, error: err?.message ?? String(err) };
        }
      })();
    }

    return undefined;
  };

  const onChanged = async (changes) => {
    const intervalChange = changes?.scanIntervalHours;
    if (!intervalChange) return;
    const value = intervalChange.newValue;
    if (typeof value === 'number' && value >= 1) {
      await ensureScanAlarm({ scanIntervalHours: value, alarms: api.alarms });
    }
  };

  api.runtime.onInstalled.addListener(onInstalled);
  api.alarms.onAlarm.addListener(onAlarm);
  api.runtime.onMessage.addListener(onMessage);
  api.storage?.onChanged?.addListener(onChanged);

  return {
    dispose() {
      api.runtime.onInstalled.removeListener(onInstalled);
      api.alarms.onAlarm.removeListener(onAlarm);
      api.runtime.onMessage.removeListener(onMessage);
      api.storage?.onChanged?.removeListener(onChanged);
    },
  };
}

const base = globalThis.browser ?? globalThis.chrome;
const inNode = typeof process !== 'undefined' && process.versions?.node;
if (base && !inNode) {
  createBackground({ browser: base });
}
