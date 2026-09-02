export interface AppSettings {
  apiKey: string;
  apiUrl: string;
  threshold: number;
}

const SETTINGS_KEY = 'jobfoundry_settings';

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  apiUrl:
    import.meta.env.VITE_API_URL !== undefined
      ? import.meta.env.VITE_API_URL
      : typeof window !== 'undefined'
        ? window.location.origin
        : 'http://localhost:8080',
  threshold: 75,
};


export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      apiKey: parsed.apiKey || '',
      apiUrl: parsed.apiUrl || DEFAULT_SETTINGS.apiUrl,
      threshold:
        typeof parsed.threshold === 'number' ? parsed.threshold : DEFAULT_SETTINGS.threshold,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
