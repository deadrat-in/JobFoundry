import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.mjs';
import { buildApp } from '../src/app.mjs';

test('GET /api/v1/diagnostics returns database counts and system health', async () => {
  const db = openDb({ path: ':memory:' });
  const app = buildApp({ db, jwtSecret: 'test-secret', logger: false });

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/diagnostics',
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.status, 'healthy');
  assert.equal(typeof data.database.totalJobs, 'number');
  assert.equal(typeof data.database.totalUsers, 'number');
  assert.equal(typeof data.uptime, 'number');
});

test('request ID propagation: honors incoming x-request-id or generates one', async () => {
  const db = openDb({ path: ':memory:' });
  const app = buildApp({ db, jwtSecret: 'test-secret', logger: false });

  // 1. Custom x-request-id header passed
  const resCustom = await app.inject({
    method: 'GET',
    url: '/health',
    headers: {
      'x-request-id': 'custom-req-trace-12345',
    },
  });
  assert.equal(resCustom.statusCode, 200);
  assert.equal(resCustom.headers['x-request-id'], 'custom-req-trace-12345');

  // 2. No x-request-id passed -> auto generated
  const resAuto = await app.inject({
    method: 'GET',
    url: '/health',
  });
  assert.equal(resAuto.statusCode, 200);
  assert.match(resAuto.headers['x-request-id'], /^req_/);
});
