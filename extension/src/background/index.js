import { getConfig as readConfig } from '../shared/config.js';
import { ensureScanAlarm, SCAN_ALARM_NAME } from './alarms.js';

const defaultRunScan = async () => {
  console.log('[JobFoundry] scan requested — no providers wired yet (Phase 03)');
  return [];
};

export function createBackground({ browser, runScan = defaultRunScan, getConfig = readConfig }) {
  const api = browser;
  if (!api) throw new Error('browser API unavailable');

  const onInstalled = async () => {
    const config = await getConfig();
    await ensureScanAlarm({
      scanIntervalHours: config.scanIntervalHours,
      alarms: api.alarms,
    });
  };

  const onAlarm = async (alarm) => {
    if (alarm?.name === SCAN_ALARM_NAME) {
      await runScan();
    }
  };

  const onMessage = (message) => {
    if (message?.type !== 'popup:scanNow') return undefined;
    return (async () => {
      try {
        const jobs = await runScan();
        return { ok: true, scanned: Array.isArray(jobs) ? jobs.length : 0 };
      } catch (err) {
        return { ok: false, error: err?.message ?? String(err) };
      }
    })();
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
