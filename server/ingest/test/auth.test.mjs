import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.mjs';
import { buildApp } from '../src/app.mjs';
import { hashPassword, verifyPassword } from '../src/auth/passwords.mjs';
import { createToken, verifyToken } from '../src/auth/tokens.mjs';

test('passwords: hashing and verification with scrypt', async () => {
  const hash = await hashPassword('SecretPassword123!');
  assert.ok(hash.includes(':'), 'Hash format should be salt:key');
  assert.equal(await verifyPassword('SecretPassword123!', hash), true);
  assert.equal(await verifyPassword('WrongPassword', hash), false);
  assert.equal(await verifyPassword('', hash), false);
});

test('tokens: JWT create and verify with expiration and tamper resistance', () => {
  const secret = 'custom-test-secret-42';
  const token = createToken({ userId: 'u_123', email: 'test@example.com' }, secret, 1);
  assert.ok(token);

  const payload = verifyToken(token, secret);
  assert.equal(payload.userId, 'u_123');
  assert.equal(payload.email, 'test@example.com');

  // Wrong secret fails
  assert.equal(verifyToken(token, 'wrong-secret'), null);

  // Tampered payload fails
  const parts = token.split('.');
  const tampered = `${parts[0]}.eyJhZG1pbiI6dHJ1ZX0.${parts[2]}`;
  assert.equal(verifyToken(tampered, secret), null);
});

test('auth routes: register, login, me, rotate-api-key flow', async () => {
  const db = openDb({ path: ':memory:' });
  const app = buildApp({ db, jwtSecret: 'test-jwt-key' });

  // 1. Register a new user
  const regRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: 'Alice@Example.com',
      password: 'password123',
      name: 'Alice Developer',
    },
  });
  assert.equal(regRes.statusCode, 201);
  const regBody = JSON.parse(regRes.body);
  assert.equal(regBody.user.email, 'alice@example.com');
  assert.equal(regBody.user.name, 'Alice Developer');
  assert.ok(regBody.user.apiKey.startsWith('jf_'));
  assert.ok(regBody.token);

  const token = regBody.token;
  const userApiKey = regBody.user.apiKey;

  // 2. Duplicate registration returns 409
  const dupRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: 'alice@example.com',
      password: 'anotherpassword',
    },
  });
  assert.equal(dupRes.statusCode, 409);

  // 3. Login with correct credentials
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: {
      email: 'alice@example.com',
      password: 'password123',
    },
  });
  assert.equal(loginRes.statusCode, 200);
  const loginBody = JSON.parse(loginRes.body);
  assert.equal(loginBody.user.id, regBody.user.id);
  assert.ok(loginBody.token);

  // 4. Login with wrong password returns 401
  const badLoginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: {
      email: 'alice@example.com',
      password: 'wrongpassword',
    },
  });
  assert.equal(badLoginRes.statusCode, 401);

  // 5. GET /api/v1/auth/me with JWT
  const meRes = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(meRes.statusCode, 200);
  assert.equal(JSON.parse(meRes.body).user.email, 'alice@example.com');

  // 6. GET /api/v1/auth/me with personal API key
  const meApiRes = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { Authorization: `Bearer ${userApiKey}` },
  });
  assert.equal(meApiRes.statusCode, 200);
  assert.equal(JSON.parse(meApiRes.body).user.id, regBody.user.id);

  // 7. Rotate API key
  const rotateRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/api-key/rotate',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(rotateRes.statusCode, 200);
  const newApiKey = JSON.parse(rotateRes.body).apiKey;
  assert.ok(newApiKey.startsWith('jf_'));
  assert.notEqual(newApiKey, userApiKey);

  // Old API key no longer valid
  const oldKeyRes = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { Authorization: `Bearer ${userApiKey}` },
  });
  assert.equal(oldKeyRes.statusCode, 401);

  // New API key works
  const newKeyRes = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { Authorization: `Bearer ${newApiKey}` },
  });
  assert.equal(newKeyRes.statusCode, 200);
});
