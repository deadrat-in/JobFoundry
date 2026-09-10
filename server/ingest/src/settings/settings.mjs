/**
 * Settings management service for JobFoundry.
 * Provides SQLite persistence with .env fallback and secure secret masking.
 */

export const SENSITIVE_KEYS = new Set(['scorer_api_key', 'tailor_api_key', 'opik_api_key']);

export const SETTINGS_METADATA = {
  scorer_model: {
    env: 'SCORER_MODEL',
    default: 'openrouter/google/gemini-2.0-flash-exp:free',
    type: 'string',
  },
  scorer_provider: {
    env: 'SCORER_PROVIDER',
    default: 'openrouter',
    type: 'string',
  },
  scorer_api_key: {
    env: ['OPENROUTER_API_KEY', 'SCORER_API_KEY', 'OPENAI_API_KEY'],
    default: '',
    type: 'string',
    secret: true,
  },
  scorer_api_base: {
    env: ['OPENROUTER_API_BASE', 'SCORER_API_BASE'],
    default: 'http://127.0.0.1:8318',
    type: 'string',
  },
  scorer_threshold: {
    env: 'SCORER_THRESHOLD',
    default: 75,
    type: 'number',
  },
  worker_enabled: {
    env: 'WORKER_ENABLED',
    default: true,
    type: 'boolean',
  },
  worker_poll_interval_seconds: {
    env: 'WORKER_POLL_INTERVAL_SECONDS',
    default: 10,
    type: 'number',
  },
  tailor_model: {
    env: 'TAILOR_MODEL',
    default: 'openrouter/google/gemini-2.0-flash-exp:free',
    type: 'string',
  },
  tailor_api_key: {
    env: ['OPENAI_API_KEY', 'OPENROUTER_API_KEY'],
    default: '',
    type: 'string',
    secret: true,
  },
  tailor_api_base: {
    env: ['OPENAI_BASE_URL', 'OPENAI_API_BASE', 'OPENROUTER_API_BASE'],
    default: 'http://127.0.0.1:8318',
    type: 'string',
  },
  tailor_theme: {
    env: 'DEFAULT_THEME',
    default: 'jsonresume-theme-folio',
    type: 'string',
  },
  tailor_timeout_seconds: {
    env: 'TAILOR_TIMEOUT_SECONDS',
    default: 900,
    type: 'number',
  },
  opik_enabled: {
    env: null,
    default: false,
    type: 'boolean',
  },
  opik_project_name: {
    env: 'OPIK_PROJECT_NAME',
    default: 'jobfoundry',
    type: 'string',
  },
  opik_api_key: {
    env: 'OPIK_API_KEY',
    default: '',
    type: 'string',
    secret: true,
  },
  opik_workspace: {
    env: 'OPIK_WORKSPACE',
    default: '',
    type: 'string',
  },
  opik_url_override: {
    env: 'OPIK_URL_OVERRIDE',
    default: '',
    type: 'string',
  },
  theme_color_mode: {
    env: null,
    default: 'system',
    type: 'string',
  },
  theme_accent: {
    env: null,
    default: 'indigo',
    type: 'string',
  },
};

/**
 * Permitted origins for LLM API base URLs.
 * Prevents SSRF and credential exfiltration to attacker-controlled hosts.
 * Extend at runtime via the ALLOWED_LLM_BASES env var (comma-separated origins,
 * e.g. "https://my-proxy.internal,http://localhost:11434").
 */
export function getAllowedApiBaseOrigins(env = process.env) {
  const defaults = [
    'https://openrouter.ai',
    'https://api.openai.com',
    'https://openai.com',
    'https://api.anthropic.com',
    'https://generativelanguage.googleapis.com',
    'http://127.0.0.1:8318',
    'http://localhost:8318',
    'http://127.0.0.1:11434',
    'http://localhost:11434',
  ];

  const extra = (env.ALLOWED_LLM_BASES || '')
    .split(',')
    .map((s) => {
      const trimmed = s.trim();
      if (!trimmed) return null;
      try {
        // Parse through URL so default ports are canonicalized (e.g. :443 → dropped)
        // matching what validateApiBase() extracts via parsed.origin.
        return new URL(trimmed).origin;
      } catch {
        return null; // skip malformed entries silently
      }
    })
    .filter(Boolean);

  return new Set([...defaults, ...extra]);
}

/**
 * Validates that an API base URL belongs to an allowed origin.
 * Throws an error if the URL is not permitted.
 * @param {string} val - The URL to validate.
 * @param {object} [env=process.env]
 */
export function validateApiBase(val, env = process.env) {
  if (val === undefined || val === null || val === '') return;
  if (typeof val !== 'string') {
    throw new Error('API base URL must be a string');
  }
  if (!val.trim()) return;
  let parsed;
  try {
    parsed = new URL(val.trim());
  } catch {
    throw new Error(`Invalid URL: "${val}"`);
  }
  // Normalize: only allow http/https schemes, reject credentials in URL
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`API base URL must use http or https scheme, got "${parsed.protocol}"`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('API base URL must not contain credentials (user:pass@host)');
  }
  const origin = parsed.origin;
  const allowed = getAllowedApiBaseOrigins(env);
  if (!allowed.has(origin)) {
    throw new Error(
      `API base URL "${origin}" is not in the allowed origins list. ` +
        `Permitted origins: ${[...allowed].join(', ')}. ` +
        `Add custom origins via the ALLOWED_LLM_BASES environment variable.`
    );
  }
}

/**
 * Masks a secret string for safe client display.
 */
export function maskSecret(val) {
  if (!val || typeof val !== 'string') return '';
  const trimmed = val.trim();
  if (trimmed.length <= 8) return '••••••••';
  const prefix = trimmed.slice(0, Math.min(6, Math.floor(trimmed.length / 3)));
  const suffix = trimmed.slice(-Math.min(4, Math.floor(trimmed.length / 4)));
  return `${prefix}••••••••${suffix}`;
}

/**
 * Checks if a value appears to be a masked placeholder.
 */
export function isMaskedSecret(val) {
  return typeof val === 'string' && val.includes('••••');
}

/**
 * Resolves an environment variable fallback value.
 */
function getEnvValue(envKey, env = process.env) {
  if (!envKey) return undefined;
  if (Array.isArray(envKey)) {
    for (const k of envKey) {
      if (env[k] !== undefined && env[k] !== '') {
        return env[k];
      }
    }
    return undefined;
  }
  return env[envKey];
}

/**
 * Coerces raw string value from SQLite / env into target schema type.
 */
function coerceValue(val, type) {
  if (val === undefined || val === null) return val;
  if (type === 'number') {
    const num = Number(val);
    return isNaN(num) ? 0 : num;
  }
  if (type === 'boolean') {
    if (typeof val === 'boolean') return val;
    return String(val).toLowerCase() === 'true' || val === '1' || val === 1;
  }
  return String(val);
}

/**
 * Reads all effective settings from SQLite, falling back to process.env and defaults.
 * @param {import('better-sqlite3').Database} db
 * @param {object} [options]
 * @param {boolean} [options.maskSecrets=true]
 * @param {object} [options.env=process.env]
 */
export function getAllSettings(db, { maskSecrets = true, env = process.env } = {}) {
  const dbRows = db.prepare('SELECT key, value, updated_at FROM system_settings').all();
  const dbMap = new Map(dbRows.map((r) => [r.key, r]));

  const result = {};
  const meta = {};

  for (const [key, spec] of Object.entries(SETTINGS_METADATA)) {
    let rawVal;
    let source = 'default';
    let updatedAt = null;

    if (dbMap.has(key)) {
      rawVal = dbMap.get(key).value;
      updatedAt = dbMap.get(key).updated_at;
      source = 'database';
    } else {
      const envVal = getEnvValue(spec.env, env);
      if (envVal !== undefined && envVal !== '') {
        rawVal = envVal;
        source = 'env';
      } else {
        rawVal = spec.default;
        source = 'default';
      }
    }

    const coerced = coerceValue(rawVal, spec.type);
    const hasValue = spec.secret ? Boolean(coerced && String(coerced).trim().length > 0) : true;

    if (spec.secret && maskSecrets) {
      result[key] = maskSecret(coerced);
    } else {
      result[key] = coerced;
    }

    meta[key] = {
      source,
      hasCustomKey: hasValue,
      updatedAt,
      type: spec.type,
      secret: Boolean(spec.secret),
    };
  }

  return { settings: result, meta };
}

/**
 * Returns a single effective setting value (unmasked) for internal service execution.
 */
export function getEffectiveSetting(db, key, env = process.env) {
  const spec = SETTINGS_METADATA[key];
  if (!spec) return undefined;

  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
  if (row && row.value !== undefined && row.value !== '') {
    return coerceValue(row.value, spec.type);
  }

  const envVal = getEnvValue(spec.env, env);
  if (envVal !== undefined && envVal !== '') {
    return coerceValue(envVal, spec.type);
  }

  return spec.default;
}

/**
 * Updates settings in SQLite system_settings.
 * Preserves existing secrets if user passes masked value or empty string.
 */
export function updateSettings(db, newValues = {}) {
  const now = Date.now();

  const insertOrUpdate = db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);

  const deleteKey = db.prepare('DELETE FROM system_settings WHERE key = ?');

  const updateTx = db.transaction((entries) => {
    for (const [key, val] of Object.entries(entries)) {
      const spec = SETTINGS_METADATA[key];
      if (!spec) continue;

      // Handle resetting to default
      if (val === null) {
        deleteKey.run(key);
        continue;
      }

      // Handle secrets: preserve existing if masked or blank
      if (spec.secret) {
        if (isMaskedSecret(val) || val === '') {
          continue;
        }
      }

      // Validate thresholds
      if (key === 'scorer_threshold') {
        const num = Number(val);
        if (isNaN(num) || num < 0 || num > 100) {
          throw new Error('scorer_threshold must be a number between 0 and 100');
        }
      }

      // Validate API base URLs against allowlist to prevent SSRF / credential leakage
      if (key === 'scorer_api_base' || key === 'tailor_api_base') {
        validateApiBase(val);
      }

      // Coerce & store as string
      const coerced = coerceValue(val, spec.type);
      insertOrUpdate.run(key, String(coerced), now);
    }
  });

  updateTx(newValues);
  return getAllSettings(db, { maskSecrets: true });
}
