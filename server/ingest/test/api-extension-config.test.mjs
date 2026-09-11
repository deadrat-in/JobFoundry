import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.mjs';
import { openDb } from '../src/db/index.mjs';

test('GET & PUT /api/v1/extension/config with auth and validation', async () => {
  const db = openDb({ path: ':memory:' });
  const app = buildApp({
    db,
    apiKeys: ['test-api-key'],
    serverUrl: 'http://localhost:8080',
    logger: false,
  });

  try {
    // 1. Unauthenticated GET returns default bundle without exposing apiKey
    const seedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/extension/config',
    });
    assert.equal(seedRes.statusCode, 200);
    const seedData = JSON.parse(seedRes.payload);
    assert.equal(seedData.serverUrl, 'http://localhost:8080');
    assert.equal(seedData.apiKey, null);
    assert.equal(seedData.scanIntervalHours, 6);
    assert.equal(seedData.maxPostingAgeDays, 30);
    assert.ok(Array.isArray(seedData.titleFilter.negative));
    assert.equal(seedData.portals.himalayas, true);
    assert.equal(seedData.portals.remoteok, false);

    // 1b. Authenticated GET returns user's apiKey
    const authGet = await app.inject({
      method: 'GET',
      url: '/api/v1/extension/config',
      headers: { authorization: 'Bearer test-api-key' },
    });
    assert.equal(authGet.statusCode, 200);
    assert.equal(authGet.json().apiKey, 'test-api-key');

    // 2. PUT without auth returns 401
    const unauthPut = await app.inject({
      method: 'PUT',
      url: '/api/v1/extension/config',
      payload: { maxPostingAgeDays: 14 },
    });
    assert.equal(unauthPut.statusCode, 401);

    // 3. PUT with invalid payload returns 400
    const invalidPut = await app.inject({
      method: 'PUT',
      url: '/api/v1/extension/config',
      headers: { authorization: 'Bearer test-api-key' },
      payload: { scanIntervalHours: 0 },
    });
    assert.equal(invalidPut.statusCode, 400);
    assert.match(invalidPut.json().error, /scanIntervalHours/);

    const invalidTypePut = await app.inject({
      method: 'PUT',
      url: '/api/v1/extension/config',
      headers: { authorization: 'Bearer test-api-key' },
      payload: { scanIntervalHours: '6' },
    });
    assert.equal(invalidTypePut.statusCode, 400);
    assert.match(invalidTypePut.json().error, /scanIntervalHours/);

    const invalidTitlePut = await app.inject({
      method: 'PUT',
      url: '/api/v1/extension/config',
      headers: { authorization: 'Bearer test-api-key' },
      payload: { titleFilter: { positive: 'not-an-array' } },
    });
    assert.equal(invalidTitlePut.statusCode, 400);

    // 4. Valid PUT updates config
    const validPut = await app.inject({
      method: 'PUT',
      url: '/api/v1/extension/config',
      headers: { authorization: 'Bearer test-api-key' },
      payload: {
        maxPostingAgeDays: 14,
        titleFilter: {
          positive: ['Software Engineer', 'Fullstack'],
          negative: ['intern', 'junior'],
        },
        locationFilter: {
          allow: ['remote', 'worldwide', 'europe'],
          block: ['hybrid'],
        },
        portals: {
          remoteok: true,
          himalayas: false,
        },
      },
    });
    assert.equal(validPut.statusCode, 200);
    const putData = validPut.json();
    assert.equal(putData.ok, true);
    assert.equal(putData.config.maxPostingAgeDays, 14);
    assert.deepEqual(putData.config.titleFilter.positive, ['Software Engineer', 'Fullstack']);
    assert.deepEqual(putData.config.titleFilter.negative, ['intern', 'junior']);
    assert.deepEqual(putData.config.locationFilter.allow, ['remote', 'worldwide', 'europe']);
    assert.deepEqual(putData.config.locationFilter.block, ['hybrid']);
    assert.equal(putData.config.portals.remoteok, true);
    assert.equal(putData.config.portals.himalayas, false);
    // Other default portals remain intact
    assert.equal(putData.config.portals.arbeitnow, true);

    // 5. Subsequent GET returns updated configuration
    const getUpdated = await app.inject({
      method: 'GET',
      url: '/api/v1/extension/config',
      headers: { authorization: 'Bearer test-api-key' },
    });
    assert.equal(getUpdated.statusCode, 200);
    const getData = getUpdated.json();
    assert.equal(getData.maxPostingAgeDays, 14);
    assert.deepEqual(getData.titleFilter.positive, ['Software Engineer', 'Fullstack']);
    assert.equal(getData.portals.remoteok, true);
    assert.equal(getData.portals.himalayas, false);

    // 6. Unauthenticated GET still returns clean defaults, not updated operator config
    const unauthGetAfterPut = await app.inject({
      method: 'GET',
      url: '/api/v1/extension/config',
    });
    assert.equal(unauthGetAfterPut.statusCode, 200);
    assert.equal(unauthGetAfterPut.json().portals.remoteok, false);
    assert.equal(unauthGetAfterPut.json().maxPostingAgeDays, 30);
  } finally {
    await app.close();
  }
});

test('per-user extension configuration isolation', async () => {
  const db = openDb({ path: ':memory:' });
  const app = buildApp({
    db,
    apiKeys: ['fallback-key'],
    serverUrl: 'http://localhost:8080',
    logger: false,
  });

  const now = Date.now();
  db.prepare(
    'INSERT INTO users (id, email, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('user-1', 'alice@test.com', 'hash', 'alice-key', now, now);

  db.prepare(
    'INSERT INTO users (id, email, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('user-2', 'bob@test.com', 'hash', 'bob-key', now, now);

  try {
    // Alice updates her keywords and portals
    const alicePut = await app.inject({
      method: 'PUT',
      url: '/api/v1/extension/config',
      headers: { authorization: 'Bearer alice-key' },
      payload: {
        titleFilter: {
          positive: ['Rust Engineer', 'Systems'],
          negative: ['manager'],
        },
        portals: {
          remoteok: true,
        },
      },
    });
    assert.equal(alicePut.statusCode, 200);

    // Bob checks his config - must NOT have Alice's keywords or portal overrides
    const bobGet = await app.inject({
      method: 'GET',
      url: '/api/v1/extension/config',
      headers: { authorization: 'Bearer bob-key' },
    });
    assert.equal(bobGet.statusCode, 200);
    const bobData = bobGet.json();
    assert.deepEqual(bobData.titleFilter.positive, []);
    assert.equal(bobData.portals.remoteok, false);
    assert.equal(bobData.apiKey, 'bob-key');
    assert.equal(bobData.userEmail, 'bob@test.com');

    // Alice checks her config
    const aliceGet = await app.inject({
      method: 'GET',
      url: '/api/v1/extension/config',
      headers: { authorization: 'Bearer alice-key' },
    });
    assert.equal(aliceGet.statusCode, 200);
    const aliceData = aliceGet.json();
    assert.deepEqual(aliceData.titleFilter.positive, ['Rust Engineer', 'Systems']);
    assert.equal(aliceData.portals.remoteok, true);
    assert.equal(aliceData.apiKey, 'alice-key');
    assert.equal(aliceData.userEmail, 'alice@test.com');
  } finally {
    await app.close();
  }
});
