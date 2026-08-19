import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.mjs';
import { buildApp } from '../src/app.mjs';
import { validateResumeJson } from '../src/resumes/resumes.mjs';

const SAMPLE_RESUME = {
  basics: {
    name: 'Alice Developer',
    label: 'Senior Staff Engineer',
    email: 'alice@example.com',
    summary: 'Distributed systems architect with 10+ years experience.',
  },
  skills: [
    { name: 'Distributed Systems', keywords: ['Raft', 'Paxos', 'Kafka'] },
    { name: 'Languages', keywords: ['Go', 'Rust', 'TypeScript'] },
  ],
  work: [
    {
      name: 'Tech Corp',
      position: 'Staff Engineer',
      startDate: '2020-01-01',
      highlights: ['Scaled streaming platform to 1M msgs/sec'],
    },
  ],
};

test('validateResumeJson checks JSON Resume v1.0.0 schema compliance', () => {
  assert.doesNotThrow(() => validateResumeJson(SAMPLE_RESUME));

  // Non-JSON string throws
  assert.throws(() => validateResumeJson('not-json'), /Invalid JSON/);

  // Invalid email format throws
  assert.throws(
    () =>
      validateResumeJson({
        basics: {
          name: 'Bob',
          email: 'invalid-email-format',
        },
      }),
    /email/
  );

  // Disallowed root property throws
  assert.throws(
    () =>
      validateResumeJson({
        basics: { name: 'Bob' },
        disallowedRootProperty: true,
      }),
    /additional properties/
  );
});

test('resumes API: upload valid schema, reject invalid schema, switch active, delete', async () => {
  const db = openDb({ path: ':memory:' });
  const app = buildApp({ db, jwtSecret: 'test-secret' });

  // Register user
  const regRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: 'alice@test.com', password: 'password123' },
  });
  const token = JSON.parse(regRes.body).token;
  const headers = { Authorization: `Bearer ${token}` };

  // 1. Upload invalid resume (violates schema) -> 400 Bad Request
  const badUploadRes = await app.inject({
    method: 'POST',
    url: '/api/v1/resumes',
    headers,
    payload: {
      title: 'Bad Resume',
      resumeJson: {
        basics: {
          name: 'Bob',
          email: 'not-an-email',
        },
        illegalProperty: 123,
      },
    },
  });
  assert.equal(badUploadRes.statusCode, 400);
  assert.match(JSON.parse(badUploadRes.body).error, /JSON Resume validation failed/);

  // 2. Upload valid resume -> 201 Created
  const uploadRes1 = await app.inject({
    method: 'POST',
    url: '/api/v1/resumes',
    headers,
    payload: {
      title: 'Staff Backend Resume',
      resumeJson: SAMPLE_RESUME,
    },
  });
  assert.equal(uploadRes1.statusCode, 201);
  const r1 = JSON.parse(uploadRes1.body).resume;
  assert.equal(r1.title, 'Staff Backend Resume');
  assert.equal(r1.isActive, true);

  // 3. Upload second valid resume
  const resume2Data = {
    ...SAMPLE_RESUME,
    basics: { ...SAMPLE_RESUME.basics, label: 'Engineering Leader' },
  };
  const uploadRes2 = await app.inject({
    method: 'POST',
    url: '/api/v1/resumes',
    headers,
    payload: {
      title: 'Leadership Resume',
      resumeJson: resume2Data,
    },
  });
  assert.equal(uploadRes2.statusCode, 201);
  const r2 = JSON.parse(uploadRes2.body).resume;
  assert.equal(r2.isActive, true);

  // 4. GET active resume returns r2
  const activeRes = await app.inject({ method: 'GET', url: '/api/v1/resumes/active', headers });
  assert.equal(activeRes.statusCode, 200);
  assert.equal(JSON.parse(activeRes.body).resume.id, r2.id);

  // 5. Switch active resume back to r1
  const switchRes = await app.inject({
    method: 'PUT',
    url: `/api/v1/resumes/${r1.id}/active`,
    headers,
  });
  assert.equal(switchRes.statusCode, 200);

  const activeRes2 = await app.inject({ method: 'GET', url: '/api/v1/resumes/active', headers });
  assert.equal(JSON.parse(activeRes2.body).resume.id, r1.id);

  // 6. Delete resume r2
  const delRes = await app.inject({
    method: 'DELETE',
    url: `/api/v1/resumes/${r2.id}`,
    headers,
  });
  assert.equal(delRes.statusCode, 200);
});
