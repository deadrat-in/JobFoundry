import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../src/db/migrate.mjs';
import {
  getAllSettings,
  getEffectiveSetting,
  updateSettings,
  maskSecret,
  isMaskedSecret,
  isRegisteredUser,
} from '../src/settings/settings.mjs';

function insertUser(db, id, email = `${id}@example.com`, apiKey = `jf-key-${id}`) {
  const now = Date.now();
  db.prepare(
    'INSERT INTO users (id, email, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, email, 'hash', apiKey, now, now);
}

test('maskSecret correctly masks API keys', () => {
  assert.equal(maskSecret(''), '');
  assert.equal(maskSecret('1234'), '••••••••');
  const masked = maskSecret('mock-api-key-sample-token-1234567890');
  assert.match(masked, /^mock-.*••••••••.*7890$/);
  assert.equal(isMaskedSecret(masked), true);
  assert.equal(isMaskedSecret('mock-api-key-sample-token-1234567890'), false);
});

test('getAllSettings returns defaults when DB and env are empty', () => {
  const db = new Database(':memory:');
  migrate(db);

  const { settings, meta } = getAllSettings(db, { env: {} });
  assert.equal(settings.scorer_model, 'openrouter/google/gemini-2.0-flash-exp:free');
  assert.equal(settings.scorer_threshold, 75);
  assert.equal(meta.scorer_model.source, 'default');
  assert.equal(meta.scorer_threshold.source, 'default');
});

test('getAllSettings respects process.env over defaults', () => {
  const db = new Database(':memory:');
  migrate(db);

  const fakeEnv = {
    SCORER_MODEL: 'custom/model-from-env',
    SCORER_THRESHOLD: '85',
    OPENROUTER_API_KEY: 'sk-or-env-secret-123456789',
  };

  const { settings, meta } = getAllSettings(db, { env: fakeEnv });
  assert.equal(settings.scorer_model, 'custom/model-from-env');
  assert.equal(settings.scorer_threshold, 85);
  assert.equal(meta.scorer_model.source, 'env');
  assert.equal(meta.scorer_threshold.source, 'env');
  assert.equal(meta.scorer_api_key.source, 'env');
  assert.match(settings.scorer_api_key, /••••••••/);
});

test('updateSettings writes to SQLite and overrides env', () => {
  const db = new Database(':memory:');
  migrate(db);

  const fakeEnv = {
    SCORER_MODEL: 'custom/model-from-env',
    SCORER_THRESHOLD: '85',
  };

  updateSettings(db, {
    scorer_model: 'custom/model-from-db',
    scorer_threshold: 90,
    scorer_api_key: 'sk-or-my-new-db-key-123456',
  });

  const { settings, meta } = getAllSettings(db, { env: fakeEnv });
  assert.equal(settings.scorer_model, 'custom/model-from-db');
  assert.equal(settings.scorer_threshold, 90);
  assert.equal(meta.scorer_model.source, 'system');
  assert.equal(meta.scorer_threshold.source, 'system');
  assert.equal(meta.scorer_api_key.source, 'system');

  // Verify getEffectiveSetting retrieves unmasked value
  const unmaskedKey = getEffectiveSetting(db, 'scorer_api_key', fakeEnv);
  assert.equal(unmaskedKey, 'sk-or-my-new-db-key-123456');

  // If user sends back the masked key, it should NOT overwrite the real key
  updateSettings(db, {
    scorer_api_key: settings.scorer_api_key,
    scorer_threshold: 95,
  });

  const preservedKey = getEffectiveSetting(db, 'scorer_api_key', fakeEnv);
  assert.equal(preservedKey, 'sk-or-my-new-db-key-123456');
  assert.equal(getEffectiveSetting(db, 'scorer_threshold', fakeEnv), 95);
});

test('updateSettings rejects non-string scorer_api_base and tailor_api_base values', () => {
  const db = new Database(':memory:');
  migrate(db);

  // Arrays must not be coerced to string and stored - they bypass validation
  assert.throws(
    () => updateSettings(db, { scorer_api_base: ['https://attacker.com'] }),
    /must be a string/
  );
  assert.throws(
    () => updateSettings(db, { tailor_api_base: { href: 'https://attacker.com' } }),
    /must be a string/
  );
  assert.throws(() => updateSettings(db, { scorer_api_base: 12345 }), /must be a string/);

  // Verify nothing was stored
  const { settings } = getAllSettings(db, { env: {} });
  assert.equal(settings.scorer_api_base, 'http://127.0.0.1:8318'); // default unchanged
});

test('isRegisteredUser distinguishes real users from operator identities', () => {
  const db = new Database(':memory:');
  migrate(db);

  insertUser(db, 'alice');

  assert.equal(isRegisteredUser(db, 'alice'), true);
  assert.equal(isRegisteredUser(db, 'legacy-admin'), false);
  assert.equal(isRegisteredUser(db, 'dev-user'), false);
  assert.equal(isRegisteredUser(db, 'nobody'), false);
  assert.equal(isRegisteredUser(db, undefined), false);
});

test('per-user settings merge with system/env and are isolated between users', () => {
  const db = new Database(':memory:');
  migrate(db);

  insertUser(db, 'alice');
  insertUser(db, 'bob');

  const fakeEnv = {
    SCORER_MODEL: 'custom/model-from-env',
    SCORER_THRESHOLD: '85',
    OPENROUTER_API_KEY: 'sk-or-env-secret-123456789',
  };

  // Operator writes a system-level override
  updateSettings(db, { scorer_model: 'custom/model-from-system' });

  // Alice sets her own key + model; Bob sets only a threshold
  updateSettings(db, { scorer_model: 'alice/model', scorer_api_key: 'sk-alice-123456' }, 'alice');
  updateSettings(db, { scorer_threshold: 42 }, 'bob');

  // Alice: user wins over system/env/default
  const aliceSettings = getAllSettings(db, { env: fakeEnv, userId: 'alice' });
  assert.equal(aliceSettings.settings.scorer_model, 'alice/model');
  assert.equal(aliceSettings.meta.scorer_model.source, 'user');
  assert.equal(aliceSettings.meta.scorer_api_key.source, 'user');
  assert.equal(aliceSettings.meta.scorer_threshold.source, 'env');
  assert.equal(aliceSettings.settings.scorer_threshold, 85);

  // System-level value survives underneath Alice's user override
  updateSettings(db, { scorer_model: 'bob-model' }, 'bob');
  const bobSettings = getAllSettings(db, { env: fakeEnv, userId: 'bob' });
  assert.equal(bobSettings.settings.scorer_model, 'bob-model');
  assert.equal(bobSettings.meta.scorer_model.source, 'user');
  // Bob overrode threshold from env(85) -> user(42)
  assert.equal(bobSettings.settings.scorer_threshold, 42);
  assert.equal(bobSettings.meta.scorer_threshold.source, 'user');

  // User isolation: neither user sees env key as their own; operator unaffected
  const noUser = getAllSettings(db, { env: fakeEnv });
  assert.equal(noUser.meta.scorer_api_key.source, 'env');
  assert.equal(noUser.settings.scorer_model, 'custom/model-from-system');
  assert.equal(isRegisteredUser(db, 'alice'), true);
});

test('per-user getEffectiveSetting and secret preservation', () => {
  const db = new Database(':memory:');
  migrate(db);

  insertUser(db, 'alice');
  const fakeEnv = { OPENROUTER_API_KEY: 'sk-or-env-secret-123456789' };

  updateSettings(db, { scorer_api_key: 'sk-or-alice-db-key-123456' }, 'alice');

  // Alice resolves her own key (not the env fallback)
  assert.equal(
    getEffectiveSetting(db, 'scorer_api_key', fakeEnv, 'alice'),
    'sk-or-alice-db-key-123456'
  );

  // Non-registered identity still falls back to env (legacy behavior)
  assert.equal(getEffectiveSetting(db, 'scorer_api_key', fakeEnv), 'sk-or-env-secret-123456789');

  // Sending the masked value back must NOT clobber Alice's real key
  const aliceBefore = getAllSettings(db, { userId: 'alice' });
  updateSettings(db, { scorer_api_key: aliceBefore.settings.scorer_api_key }, 'alice');
  assert.equal(
    getEffectiveSetting(db, 'scorer_api_key', fakeEnv, 'alice'),
    'sk-or-alice-db-key-123456'
  );

  // Deleting Alice's key (null) drops back to env fallback
  updateSettings(db, { scorer_api_key: null }, 'alice');
  assert.equal(
    getEffectiveSetting(db, 'scorer_api_key', fakeEnv, 'alice'),
    'sk-or-env-secret-123456789'
  );

  // Rows physically live in user_settings and are scoped to the user
  const aliceRows = db
    .prepare('SELECT user_id, key, value FROM user_settings WHERE user_id = ?')
    .all('alice');
  assert.deepEqual(
    aliceRows.map((r) => `${r.user_id}:${r.key}=${r.value}`),
    []
  );

  // Re-insert Alice's key, verify the stored row, then delete it
  updateSettings(db, { scorer_api_key: 'sk-or-alice-db-key-123456' }, 'alice');
  const stored = db
    .prepare('SELECT user_id, key, value FROM user_settings WHERE user_id = ?')
    .get('alice');
  assert.equal(stored.user_id, 'alice');
  assert.equal(stored.key, 'scorer_api_key');
  assert.equal(stored.value, 'sk-or-alice-db-key-123456');

  updateSettings(db, { scorer_api_key: null }, 'alice');
  const afterDelete = db
    .prepare('SELECT COUNT(*) AS n FROM user_settings WHERE user_id = ?')
    .get('alice');
  assert.equal(afterDelete.n, 0);

  // A registered user with no user-scoped secret never sees the masked
  // system/env fragment — the shared platform key is never surfaced to them
  updateSettings(db, { scorer_api_key: 'sk-system-operator-123456' });
  const isolated = getAllSettings(db, { env: fakeEnv, userId: 'alice' });
  assert.equal(isolated.settings.scorer_api_key, '');
  assert.equal(isolated.meta.scorer_api_key.source, 'default');
  assert.equal(isolated.meta.scorer_api_key.hasCustomKey, false);
});
