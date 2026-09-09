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
    assert.equal(putData.meta.scorer_model.source, 'database');
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
