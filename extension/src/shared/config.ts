export interface TitleFilterConfig {
  positive: string[];
  negative: string[];
}

export interface LocationFilterConfig {
  allow: string[];
  block: string[];
}

export interface TrackedCompany {
  id: string;
  name: string;
  careers_url: string;
  enabled: boolean;
}

export interface ScanRunLog {
  timestamp: number;
  totalFetched: number;
  passedFilters: number;
  ingested: number;
  deduped: number;
  error?: string;
}

export interface Config {
  serverUrl: string | null;
  apiKey: string | null;
  scanIntervalHours: number;
  passiveMode: boolean;
  activeMode: boolean;
  activeModeDelayMs: number;
  fitThreshold: number;
  titleFilter: TitleFilterConfig;
  maxPostingAgeDays: number;
  locationFilter: LocationFilterConfig;
  portals: Record<string, boolean | string | any>;
  trackedCompanies: TrackedCompany[];
}

export const DEFAULT_CONFIG: Config = {
  serverUrl: null,
  apiKey: null,
  scanIntervalHours: 6,
  passiveMode: true,
  activeMode: false,
  activeModeDelayMs: 2000,
  fitThreshold: 75,
  titleFilter: {
    positive: [
      'product manager',
      'product management',
      'product lead',
      'head of product',
      'technical product manager',
      'group product manager',
      'director + product',
      'principal product manager',
      'vp + product',
    ],
    negative: ['word:intern', 'junior', '.net', 'php', 'wordpress', 'embedded', 'firmware'],
  },
  maxPostingAgeDays: 30,
  locationFilter: {
    allow: ['remote', 'worldwide', 'anywhere'],
    block: [],
  },
  portals: {
    remoteok: true,
    weworkremotely: true,
    himalayas: true,
    arbeitnow: true,
    jobspresso: true,
    '4dayweek': true,
  },
  trackedCompanies: [],
};

export const defaults = DEFAULT_CONFIG;
const STORAGE_KEY = 'jobfoundry-config';

function getStorageArea(): any {
  const api = (globalThis as any).browser ?? (globalThis as any).chrome;
  return api?.storage?.sync ?? api?.storage?.local ?? null;
}

let inMemoryStore: Partial<Config> = {};

export function validate(config: Partial<Config>): void {
  if (config.scanIntervalHours !== undefined) {
    if (typeof config.scanIntervalHours !== 'number' || config.scanIntervalHours < 1) {
      throw new Error('scanIntervalHours must be a number >= 1');
    }
  }
  if (config.fitThreshold !== undefined) {
    if (
      typeof config.fitThreshold !== 'number' ||
      config.fitThreshold < 0 ||
      config.fitThreshold > 100
    ) {
      throw new Error('fitThreshold must be a number between 0 and 100');
    }
  }
  if (config.activeModeDelayMs !== undefined) {
    if (typeof config.activeModeDelayMs !== 'number' || config.activeModeDelayMs < 0) {
      throw new Error('activeModeDelayMs must be a non-negative number');
    }
  }
}

export async function fetchSeedConfig(
  serverUrl: string,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}
): Promise<Partial<Config>> {
  const endpoint = `${serverUrl.replace(/\/$/, '')}/api/v1/extension/config`;
  const response = await fetchImpl(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to fetch seed config from ${endpoint} (HTTP ${response.status})`);
  }
  return await response.json();
}

export async function syncSeedConfig(
  serverUrl: string,
  opts: { fetchImpl?: typeof fetch; storageImpl?: any } = {}
): Promise<Partial<Config>> {
  const seed = await fetchSeedConfig(serverUrl, opts);
  await setConfig(seed);
  return seed;
}

export async function getConfig(
  opts: { seedUrl?: string; fetchImpl?: typeof fetch; storageImpl?: any } = {}
): Promise<Config> {
  const storageArea = opts.storageImpl ?? getStorageArea();
  let stored: Partial<Config> = {};
  if (storageArea) {
    try {
      const res = await storageArea.get(STORAGE_KEY);
      stored = res?.[STORAGE_KEY] ?? res ?? {};
    } catch {
      stored = inMemoryStore;
    }
  } else {
    stored = inMemoryStore;
  }

  const merged = { ...DEFAULT_CONFIG, ...stored };
  if (opts.seedUrl && !merged.apiKey) {
    try {
      const seed = await syncSeedConfig(opts.seedUrl, opts);
      return { ...merged, ...seed };
    } catch {
      // ignore
    }
  }
  return merged;
}

export async function setConfig(patch: Partial<Config>): Promise<Config> {
  validate(patch);
  const current = await getConfig();
  const next = { ...current, ...patch };
  validate(next);

  const storageArea = getStorageArea();
  if (storageArea) {
    try {
      await storageArea.set({ [STORAGE_KEY]: next });
    } catch {
      inMemoryStore = next;
    }
  } else {
    inMemoryStore = next;
  }
  return next;
}
