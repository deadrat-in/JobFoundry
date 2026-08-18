export const defaults = {
  serverUrl: null,
  apiKey: null,
  scanIntervalHours: 6,
  passiveMode: true,
  activeMode: false,
  activeModeDelayMs: 2000,
  fitThreshold: 75,
  portals: {},
};

const KNOWN_KEYS = Object.keys(defaults);

function storage() {
  const base = globalThis.browser ?? globalThis.chrome;
  if (!base || !base.storage || !base.storage.sync) {
    throw new Error('extension storage API unavailable');
  }
  return base.storage.sync;
}

export function validate(patch) {
  const { scanIntervalHours, fitThreshold } = patch;
  if (scanIntervalHours !== undefined) {
    if (typeof scanIntervalHours !== 'number' || !Number.isFinite(scanIntervalHours)) {
      throw new Error('scanIntervalHours must be a number');
    }
    if (scanIntervalHours < 1) {
      throw new Error('scanIntervalHours must be >= 1');
    }
  }
  if (fitThreshold !== undefined) {
    if (typeof fitThreshold !== 'number' || !Number.isFinite(fitThreshold)) {
      throw new Error('fitThreshold must be a number');
    }
    if (fitThreshold < 0 || fitThreshold > 100) {
      throw new Error('fitThreshold must be between 0 and 100');
    }
  }
}

export async function fetchSeedConfig(
  serverUrl = 'http://localhost:8080',
  { fetchImpl = globalThis.fetch } = {}
) {
  const normalized = serverUrl.replace(/\/+$/, '');
  const url = `${normalized}/api/v1/extension/config`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`failed to fetch seed config: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function syncSeedConfig(
  serverUrl,
  { fetchImpl = globalThis.fetch, storageImpl } = {}
) {
  const store = storageImpl ?? storage();
  const seed = await fetchSeedConfig(serverUrl, { fetchImpl });
  const patch = {};
  for (const key of KNOWN_KEYS) {
    if (seed[key] !== undefined) {
      patch[key] = seed[key];
    }
  }
  if (Object.keys(patch).length > 0) {
    validate(patch);
    await store.set(patch);
  }
  const current = await store.get(defaults);
  return { ...defaults, ...current };
}

export async function getConfig({ seedUrl, fetchImpl = globalThis.fetch, storageImpl } = {}) {
  const store = storageImpl ?? storage();
  let stored = await store.get(defaults);
  if (seedUrl && (!stored.serverUrl || !stored.apiKey)) {
    try {
      const seeded = await syncSeedConfig(seedUrl, { fetchImpl, storageImpl: store });
      return seeded;
    } catch {
      // ignore network errors on seed fetch
    }
  }
  const out = {};
  for (const key of KNOWN_KEYS) {
    if (stored[key] !== undefined) out[key] = stored[key];
  }
  return { ...defaults, ...out };
}

export async function setConfig(patch) {
  if (!patch || typeof patch !== 'object') {
    throw new Error('setConfig requires a patch object');
  }
  validate(patch);
  const clean = {};
  for (const key of KNOWN_KEYS) {
    if (key in patch) clean[key] = patch[key];
  }
  if (Object.keys(clean).length === 0) return;
  await storage().set(clean);
}
