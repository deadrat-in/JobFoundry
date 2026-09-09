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
} from '../src/settings/settings.mjs';

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
  assert.equal(meta.scorer_model.source, 'database');
  assert.equal(meta.scorer_threshold.source, 'database');
  assert.equal(meta.scorer_api_key.source, 'database');

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
