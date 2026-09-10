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
 * Operator-trusted origins for local/internal LLM gateways (e.g. the bundled
 * Gatepass proxy at :8318 or a local Ollama at :11434).
 *
 * SSRF protection is now connection-time IP-range blocking (see
 * security/ssrf.mjs): any api_base host that resolves to a public IP is
 * allowed, and only these explicitly operator-configured origins are exempt
 * from the private/loopback/link-local blocklist so self-hosted deployments
 * keep working. Extend at runtime via the ALLOWED_LLM_BASES env var
 * (comma-separated origins, e.g. "https://my-proxy.internal,http://localhost:11434").
 */
export function getTrustedApiBaseOrigins(env = process.env) {
  const defaults = [
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
        return new URL(trimmed).origin;
      } catch {
        return null; // skip malformed entries silently
      }
    })
    .filter(Boolean);

  return new Set([...defaults, ...extra]);
}

/**
 * Validates the shape of an API base URL at write time:
 * must be a string, http/https scheme, and free of embedded credentials.
 *
 * Note: IP-range / SSRF enforcement happens at connection time
 * (security/ssrf.mjs::assertSafeOutboundUrl) to avoid a DNS-rebinding window
 * between validation and request. scheme + credentials are still rejected here
 * because they are structural and can never be valid for any deployment.
 *
 * @param {string} val - The URL to validate.
 */
export function validateApiBase(val) {
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
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`API base URL must use http or https scheme, got "${parsed.protocol}"`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('API base URL must not contain credentials (user:pass@host)');
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
 * Reads all key/value rows for a single user.
 * @param {import('better-sqlite3').Database} db
 * @param {string|null} userId
 */
function getUserSettings(db, userId) {
  if (!userId) return new Map();
  try {
    const rows = db
      .prepare('SELECT key, value, updated_at FROM user_settings WHERE user_id = ?')
      .all(userId);
    return new Map(rows.map((r) => [r.key, r]));
  } catch (err) {
    // user_settings table may be absent on very old DBs before migration
    if (String(err?.message || '').includes('no such table')) return new Map();
    throw err;
  }
}

/**
 * Reads all effective settings from SQLite, falling back to process.env and defaults.
 * Precedence for an authenticated user: user_settings → system_settings → env → default.
 * @param {import('better-sqlite3').Database} db
 * @param {object} [options]
 * @param {string} [options.userId] - authenticated user id to resolve per-user settings
 * @param {boolean} [options.maskSecrets=true]
 * @param {object} [options.env=process.env]
 */
export function getAllSettings(db, { userId = null, maskSecrets = true, env = process.env } = {}) {
  const dbRows = db.prepare('SELECT key, value, updated_at FROM system_settings').all();
  const dbMap = new Map(dbRows.map((r) => [r.key, r]));
  const userSettings = getUserSettings(db, userId);

  const result = {};
  const meta = {};

  for (const [key, spec] of Object.entries(SETTINGS_METADATA)) {
    let rawVal;
    let source = 'default';
    let updatedAt = null;

    if (userSettings.has(key)) {
      rawVal = userSettings.get(key).value;
      updatedAt = userSettings.get(key).updated_at;
      source = 'user';
    } else if (dbMap.has(key)) {
      rawVal = dbMap.get(key).value;
      updatedAt = dbMap.get(key).updated_at;
      source = 'system';
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
 * Resolves a single effective setting and the layer it came from.
 * Precedence: user_settings → system_settings → env → default.
 * Used by call sites that need to distinguish operator-trusted values from
 * user-supplied ones (e.g. SSRF strictness for api_base).
 * @returns {{ value: any, source: 'user'|'system'|'env'|'default' }}
 */
export function getEffectiveSettingWithSource(db, key, { userId = null, env = process.env } = {}) {
  const spec = SETTINGS_METADATA[key];
  if (!spec) return { value: undefined, source: 'default' };

  const userSettings = getUserSettings(db, userId);
  if (userSettings.has(key)) {
    const row = userSettings.get(key);
    if (row.value !== undefined && row.value !== '') {
      return { value: coerceValue(row.value, spec.type), source: 'user' };
    }
  }

  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
  if (row && row.value !== undefined && row.value !== '') {
    return { value: coerceValue(row.value, spec.type), source: 'system' };
  }

  const envVal = getEnvValue(spec.env, env);
  if (envVal !== undefined && envVal !== '') {
    return { value: coerceValue(envVal, spec.type), source: 'env' };
  }

  return { value: spec.default, source: 'default' };
}

/**
 * Returns a single effective setting value (unmasked) for internal service execution.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @param {object} [env=process.env]
 * @param {string} [userId] - authenticated user id; per-user value wins when present
 */
export function getEffectiveSetting(db, key, env = process.env, userId = null) {
  return getEffectiveSettingWithSource(db, key, { userId, env }).value;
}

/**
 * Returns true when the given userId refers to a real registered user row.
 * Synthetic identities (legacy-admin, dev-user) are treated as operators and
 * continue to manage operator-level system_settings.
 */
export function isRegisteredUser(db, userId) {
  if (!userId) return false;
  return Boolean(db.prepare('SELECT id FROM users WHERE id = ?').get(userId));
}

/**
 * Updates settings in SQLite.
 * Real (registered) users write to user_settings; operator identities
 * (legacy-admin/dev-user) write to system_settings.
 * Preserves existing secrets if user passes masked value or empty string.
 */
export function updateSettings(db, newValues = {}, userId = null) {
  const now = Date.now();
  const table = isRegisteredUser(db, userId) ? 'user_settings' : 'system_settings';

  const insertOrUpdate =
    table === 'user_settings'
      ? db.prepare(`
          INSERT INTO user_settings (user_id, key, value, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `)
      : db.prepare(`
          INSERT INTO system_settings (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `);

  const deleteKey =
    table === 'user_settings'
      ? db.prepare('DELETE FROM user_settings WHERE user_id = ? AND key = ?')
      : db.prepare('DELETE FROM system_settings WHERE key = ?');

  const updateTx = db.transaction((entries) => {
    for (const [key, val] of Object.entries(entries)) {
      const spec = SETTINGS_METADATA[key];
      if (!spec) continue;

      // Handle resetting to default
      if (val === null) {
        if (table === 'user_settings') {
          deleteKey.run(userId, key);
        } else {
          deleteKey.run(key);
        }
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

      // Validate API base URL shape (scheme + embedded credentials).
      // SSRF IP-range enforcement happens at connection time.
      if (key === 'scorer_api_base' || key === 'tailor_api_base') {
        validateApiBase(val);
      }

      // Coerce & store as string
      const coerced = coerceValue(val, spec.type);
      if (table === 'user_settings') {
        insertOrUpdate.run(userId, key, String(coerced), now);
      } else {
        insertOrUpdate.run(key, String(coerced), now);
      }
    }
  });

  updateTx(newValues);
  return getAllSettings(db, { userId, maskSecrets: true });
}
