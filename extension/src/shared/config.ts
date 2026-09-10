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
  userEmail?: string | null;
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
    positive: [],
    negative: ['word:intern', 'junior', '.net', 'php', 'wordpress', 'embedded', 'firmware'],
  },
  maxPostingAgeDays: 30,
  locationFilter: {
    allow: ['remote', 'worldwide', 'anywhere'],
    block: [],
  },
  portals: {
    // Global Remote — ON by default (except ✦ paid-post boards)
    remoteok: false,
    weworkremotely: false,
    himalayas: true,
    arbeitnow: true,
    jobspresso: true,
    '4dayweek': true,
    remotive: true,
    workingnomads: true,
    hackernews: true,
    cryptocurrencyjobs: true,
    nodesk: true,
    larajobs: true,
    torre: true,
    themuse: true,
    landingjobs: true,
    flowxtra: true,
    thehub: true,
    'agentic-jobs': true,
    // Regional & Niche — ON by default
    jobicy: true,
    remotli: true,
    getonbrd: true,
    manfred: true,
    wttj: true,
    nofluffjobs: true,
    justjoin: true,
    solidjobs: true,
    senjob: true,
    jobbankca: true,
    arbeitsagentur: true,
    vdab: true,
    higheredjobs: true,
    glints: true,
    jobstreet: true,
    mycareersfuture: true,
    careerviet: true,
    itviec: true,
    yourator: true,
    // Company-Specific — ON by default
    ibm: true,
    amazon: true,
    'a16z-speedrun-talent': true,
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

export async function setConfig(
  patch: Partial<Config>,
  opts: { storageImpl?: any } = {}
): Promise<Config> {
  validate(patch);
  const current = await getConfig(opts);
  const next = { ...current, ...patch };
  validate(next);

  const storageArea = opts.storageImpl ?? getStorageArea();
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

export const OFFLINE_QUEUE_KEY = 'jobfoundry-offline-queue';

export async function syncConfigFromServer(
  serverUrl: string,
  apiKey: string,
  opts: { fetchImpl?: typeof fetch; storageImpl?: any } = {}
): Promise<Config> {
  const cleanUrl = serverUrl.replace(/\/+$/, '');
  const endpoint = `${cleanUrl}/api/v1/extension/config`;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  try {
    const res = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
    });
    if (res.ok) {
      const data = await res.json();
      const serverConfig = data?.config ?? data;
      if (serverConfig && typeof serverConfig === 'object') {
        const patch: Partial<Config> = {
          serverUrl: cleanUrl,
          apiKey,
        };
        if (serverConfig.titleFilter) patch.titleFilter = serverConfig.titleFilter;
        if (serverConfig.maxPostingAgeDays !== undefined) patch.maxPostingAgeDays = serverConfig.maxPostingAgeDays;
        if (serverConfig.locationFilter) patch.locationFilter = serverConfig.locationFilter;
        if (serverConfig.portals) patch.portals = serverConfig.portals;
        if (serverConfig.passiveMode !== undefined) patch.passiveMode = serverConfig.passiveMode;
        if (serverConfig.activeMode !== undefined) patch.activeMode = serverConfig.activeMode;
        if (serverConfig.activeModeDelayMs !== undefined) patch.activeModeDelayMs = serverConfig.activeModeDelayMs;
        if (serverConfig.fitThreshold !== undefined) patch.fitThreshold = serverConfig.fitThreshold;
        if (serverConfig.scanIntervalHours !== undefined) patch.scanIntervalHours = serverConfig.scanIntervalHours;
        if (Array.isArray(serverConfig.trackedCompanies)) patch.trackedCompanies = serverConfig.trackedCompanies;
        return await setConfig(patch, opts);
      }
    }
  } catch (err) {
    console.warn?.(`[syncConfigFromServer] Failed to sync config from ${endpoint}:`, err);
  }
  return await getConfig(opts);
}

export async function getOfflineQueue(opts: { storageImpl?: any } = {}): Promise<any[]> {
  const storageArea = opts.storageImpl ?? getStorageArea();
  if (storageArea) {
    try {
      const res = await storageArea.get(OFFLINE_QUEUE_KEY);
      const queue = res?.[OFFLINE_QUEUE_KEY] ?? res?.queue ?? [];
      return Array.isArray(queue) ? queue : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function enqueueOfflineJobs(
  jobs: any[],
  opts: { storageImpl?: any; maxQueueSize?: number } = {}
): Promise<number> {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    const q = await getOfflineQueue(opts);
    return q.length;
  }
  const storageArea = opts.storageImpl ?? getStorageArea();
  const maxQueue = opts.maxQueueSize ?? 500;
  const currentQueue = await getOfflineQueue(opts);
  const seenKeys = new Set(
    currentQueue.map((j) => j.fingerprint || j.url || `${j.title}::${j.company}`)
  );

  const newJobs: any[] = [];
  for (const job of jobs) {
    const key = job.fingerprint || job.url || `${job.title}::${job.company}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      newJobs.push(job);
    }
  }

  const updatedQueue = [...currentQueue, ...newJobs].slice(-maxQueue);
  if (storageArea) {
    try {
      await storageArea.set({ [OFFLINE_QUEUE_KEY]: updatedQueue });
    } catch {
      // ignore
    }
  }
  return updatedQueue.length;
}

export async function clearOfflineQueue(opts: { storageImpl?: any } = {}): Promise<void> {
  const storageArea = opts.storageImpl ?? getStorageArea();
  if (storageArea) {
    try {
      if (typeof storageArea.remove === 'function') {
        await storageArea.remove(OFFLINE_QUEUE_KEY);
      } else {
        await storageArea.set({ [OFFLINE_QUEUE_KEY]: [] });
      }
    } catch {
      // ignore
    }
  }
}

export async function flushOfflineJobs(
  sendJobsFn: (params: { jobs: any[]; serverUrl?: string; apiKey?: string }) => Promise<any>,
  opts: { storageImpl?: any; getConfig?: () => Promise<Config> } = {}
): Promise<{ flushed: number; remaining: number }> {
  const queue = await getOfflineQueue(opts);
  if (queue.length === 0) {
    return { flushed: 0, remaining: 0 };
  }

  const gc = opts.getConfig ?? getConfig;
  const config = await gc();
  if (!config.serverUrl || !config.apiKey) {
    return { flushed: 0, remaining: queue.length };
  }

  try {
    await sendJobsFn({
      jobs: queue,
      serverUrl: config.serverUrl,
      apiKey: config.apiKey,
    });
    await clearOfflineQueue(opts);
    return { flushed: queue.length, remaining: 0 };
  } catch (err) {
    console.warn?.('[flushOfflineJobs] Failed to flush offline jobs, will retry later:', err);
    return { flushed: 0, remaining: queue.length };
  }
}

