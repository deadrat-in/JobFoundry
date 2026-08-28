import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.mjs';
import { openDb } from '../src/db/index.mjs';
import { parseJobDescription, heuristicParseJd } from '../src/jobs/parse-jd.mjs';

test('heuristicParseJd extracts title, company, and requirements', () => {
  const sampleJd = `# Senior Distributed Systems Engineer at Acme AI
Location: San Francisco, CA (Remote)
Salary: $190,000 - $240,000 / year

About the Role:
We are looking for a Senior Distributed Systems Engineer to build our AI infrastructure.

Requirements:
- 5+ years experience in Python or Go
- Deep knowledge of Kubernetes and distributed storage
- Experience with high-throughput message brokers (Kafka)

Benefits:
- Health, dental, vision
- 401(k) matching
`;

  const parsed = heuristicParseJd({ text: sampleJd, url: 'https://boards.greenhouse.io/acmeai/jobs/123' });
  assert.equal(parsed.title, 'Senior Distributed Systems Engineer');
  assert.equal(parsed.company, 'Acme AI');
  assert.equal(parsed.location, 'San Francisco, CA (Remote)');
  assert.ok(parsed.salary?.includes('$190,000'));
  assert.ok(parsed.requirements.length >= 3);
  assert.ok(parsed.requirements[0].includes('Python or Go'));
});

test('POST /api/v1/jobs/parse-jd returns structured job object', async () => {
  const db = openDb({ path: ':memory:' });
  const app = buildApp({ db, apiKeys: ['test-key'] });

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs/parse-jd',
    headers: {
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
    },
    payload: {
      text: `# AI Research Scientist at Anthropic\nLocation: Remote\n\nRequirements:\n- PhD in Machine Learning\n- Experience training LLMs`,
      url: 'https://jobs.lever.co/anthropic/scientist',
    },
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.job.title, 'AI Research Scientist');
  assert.equal(body.job.company, 'Anthropic');
  assert.equal(body.job.location, 'Remote');
  assert.ok(body.job.requirements.length >= 2);
});

test('POST /api/v1/jobs/parse-jd rejects empty or tiny input', async () => {
  const db = openDb(':memory:');
  const app = buildApp({ db, apiKeys: ['test-key'] });

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs/parse-jd',
    headers: {
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
    },
    payload: { text: 'too short' },
  });

  assert.equal(response.statusCode, 400);
});
