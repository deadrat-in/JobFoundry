import { defineBackground } from 'wxt/utils/define-background';
import { onMessage } from '../shared/messaging.ts';
import { getConfig } from '../shared/config.ts';
import type { Config } from '../shared/config.ts';
import { runScanPipeline } from '../background/scan.js';
import { sendJobs } from '../shared/ingest-client.js';
import { checkLiveness } from '../background/liveness/index.js';
import { normalizeJob, withFingerprint } from '../background/normalize.js';
import { fingerprintText } from '../background/fingerprint.js';
import { dedupJobs, createSessionCache } from '../background/dedup.js';
import { makeHttpCtx } from '../background/providers/_http.mjs';

export const SCAN_ALARM_NAME = 'jobfoundry-periodic-scan';

export async function processDiscoveredJobs({
  rawJobs,
  cache = null,
  now = Date.now,
}: {
  rawJobs: any[];
  cache?: any;
  now?: () => number;
}) {
  if (!Array.isArray(rawJobs) || rawJobs.length === 0) {
    return { ok: true, ingested: 0 };
  }
  const config = await getConfig();
  if (!config.serverUrl || !config.apiKey) {
    return { ok: false, error: 'extension not configured with serverUrl and apiKey' };
  }

  const httpCtx = makeHttpCtx();
  const dedupCache = cache ?? createSessionCache();
  const survivors: any[] = [];

  for (const raw of rawJobs) {
    try {
      const livenessResult = await checkLiveness(raw, httpCtx);
      if (livenessResult === 'expired') continue;
      const normalized = normalizeJob(raw, raw.source || 'content-script');
      const withFp = await withFingerprint(normalized, fingerprintText);
      survivors.push(withFp);
    } catch {
      // ignore malformed entries
    }
  }

  const deduped = await dedupJobs(survivors, dedupCache, { now: now() });
  if (deduped.length > 0) {
    await sendJobs({
      serverUrl: config.serverUrl,
      apiKey: config.apiKey,
      jobs: deduped,
    });
  }

  return { ok: true, ingested: deduped.length };
}

export default defineBackground(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api?.runtime?.onInstalled) return;

  const syncAlarms = async () => {
    try {
      const config = await getConfig();
      await api.alarms?.create(SCAN_ALARM_NAME, {
        periodInMinutes: Math.max(1, config.scanIntervalHours * 60),
      });
    } catch {
      // ignore in environments without alarms
    }
  };

  api.runtime.onInstalled.addListener(syncAlarms);

  api.alarms?.onAlarm?.addListener(async (alarm: any) => {
    if (alarm.name === SCAN_ALARM_NAME) {
      try {
        await runScanPipeline({ getConfig, sendJobs });
      } catch (err) {
        console.error('Periodic scan error:', err);
      }
    }
  });

  // Protocol Message Handlers
  onMessage('popup:scanNow', async () => {
    try {
      const jobs = await runScanPipeline({ getConfig, sendJobs });
      return { ok: true, scanned: Array.isArray(jobs) ? jobs.length : 0 };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  onMessage('content:jobsDiscovered', async ({ data }) => {
    try {
      return await processDiscoveredJobs({ rawJobs: data.jobs });
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  // Watch for scan interval changes
  storage.watch<Config>('sync:jobfoundry-config', async (newConfig) => {
    if (newConfig?.scanIntervalHours) {
      try {
        await api.alarms?.create(SCAN_ALARM_NAME, {
          periodInMinutes: Math.max(1, newConfig.scanIntervalHours * 60),
        });
      } catch {
        // ignore
      }
    }
  });
});
