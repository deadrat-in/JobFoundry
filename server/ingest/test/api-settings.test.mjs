import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.mjs';
import { openDb } from '../src/db/index.mjs';

test('settings API endpoints work as expected', async () => {
  const db = openDb({ path: ':memory:' });
  const app = buildApp({
    db,
    apiKeys: ['test-api-key'],
    serverUrl: 'http://localhost:8080',
    logger: false,
  });

  try {
    // 1. Unauthorized access fails
    const unauthResp = await app.inject({
      method: 'GET',
      url: '/api/v1/settings',
    });
    assert.equal(unauthResp.statusCode, 401);

    // 2. Authorized GET returns settings
    const getResp = await app.inject({
      method: 'GET',
      url: '/api/v1/settings',
      headers: { authorization: 'Bearer test-api-key' },
    });
    assert.equal(getResp.statusCode, 200);
    const getData = JSON.parse(getResp.payload);
    assert.ok(getData.settings);
    assert.ok(getData.meta);
    assert.equal(getData.settings.scorer_threshold, 75);

    // 3. Authorized PUT updates settings
    const putResp = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      headers: { authorization: 'Bearer test-api-key' },
      payload: {
        scorer_model: 'custom/model-via-api',
        scorer_threshold: 88,
        scorer_api_key: 'sk-or-new-test-api-key-123456',
      },
    });
    assert.equal(putResp.statusCode, 200);
    const putData = JSON.parse(putResp.payload);
    assert.equal(putData.ok, true);
    assert.equal(putData.settings.scorer_model, 'custom/model-via-api');
    assert.equal(putData.settings.scorer_threshold, 88);
    assert.equal(putData.meta.scorer_model.source, 'system');
    assert.match(putData.settings.scorer_api_key, /••••••••/);

    // 4. Invalid threshold is rejected
    const badPut = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      headers: { authorization: 'Bearer test-api-key' },
      payload: {
        scorer_threshold: 150,
      },
    });
    assert.equal(badPut.statusCode, 400);

    // 5. Extension config reflects new threshold
    const extResp = await app.inject({
      method: 'GET',
      url: '/api/v1/extension/config',
      headers: { authorization: 'Bearer test-api-key' },
    });
    assert.equal(extResp.statusCode, 200);
    const extData = JSON.parse(extResp.payload);
    assert.equal(extData.fitThreshold, 88);
  } finally {
    await app.close();
  }
});

test('per-user settings API isolates settings between users', async () => {
  const db = openDb({ path: ':memory:' });
  const app = buildApp({
    db,
    apiKeys: ['test-api-key'],
    serverUrl: 'http://localhost:8080',
    logger: false,
  });

  const now = Date.now();
  db.prepare(
    'INSERT INTO users (id, email, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('alice', 'alice@example.com', 'hash', 'jf-key-alice', now, now);
  db.prepare(
    'INSERT INTO users (id, email, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('bob', 'bob@example.com', 'hash', 'jf-key-bob', now, now);

  try {
    const aliceHeaders = { authorization: 'Bearer jf-key-alice' };
    const bobHeaders = { authorization: 'Bearer jf-key-bob' };

    // 1. Registered identity defaults: no shared key available
    const aliceGet = await app.inject({
      method: 'GET',
      url: '/api/v1/settings',
      headers: aliceHeaders,
    });
    assert.equal(aliceGet.statusCode, 200);
    const aliceBase = JSON.parse(aliceGet.payload);
    assert.equal(aliceBase.settings.scorer_api_key, '');
    assert.equal(aliceBase.meta.scorer_api_key.source, 'default');

    // 2. Alice writes her own key; Bob is unaffected
    const alicePut = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      headers: aliceHeaders,
      payload: { scorer_api_key: 'sk-alice-bring-123456789', scorer_model: 'alice/provider/model' },
    });
    assert.equal(alicePut.statusCode, 200);
    const alicePutData = JSON.parse(alicePut.payload);
    assert.equal(alicePutData.meta.scorer_api_key.source, 'user');
    assert.equal(alicePutData.meta.scorer_model.source, 'user');

    const aliceAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/settings',
      headers: aliceHeaders,
    });
    assert.match(JSON.parse(aliceAfter.payload).settings.scorer_api_key, /••••••••/);
    assert.equal(JSON.parse(aliceAfter.payload).meta.scorer_api_key.source, 'user');

    const bobAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/settings',
      headers: bobHeaders,
    });
    const bobData = JSON.parse(bobAfter.payload);
    assert.equal(bobData.settings.scorer_api_key, '');
    assert.equal(bobData.meta.scorer_api_key.source, 'default');

    // 3. Operator (legacy key) writes to system settings, does not see user rows
    const opPut = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      headers: { authorization: 'Bearer test-api-key' },
      payload: { scorer_threshold: 88 },
    });
    assert.equal(opPut.statusCode, 200);
    assert.equal(JSON.parse(opPut.payload).meta.scorer_threshold.source, 'system');

    // 4. Alice can delete her key back to defaults
    const aliceDel = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      headers: aliceHeaders,
      payload: { scorer_api_key: null },
    });
    assert.equal(aliceDel.statusCode, 200);
    const aliceDelData = JSON.parse(aliceDel.payload);
    assert.equal(aliceDelData.settings.scorer_api_key, '');
    assert.equal(aliceDelData.meta.scorer_api_key.source, 'default');

    // 5. Invalid api_base is still rejected per-user
    const badBase = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      headers: aliceHeaders,
      payload: { scorer_api_base: ['https://attacker.com'] },
    });
    assert.equal(badBase.statusCode, 400);
  } finally {
    await app.close();
  }
});
