import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeRelayTask,
  pollAndExecuteOnce,
  SUPPORTED_TASK_TYPES,
} from '../src/background/relay.js';

test('relay: rejects unsupported task types or invalid URLs', async () => {
  await assert.rejects(
    () => executeRelayTask({ type: 'UNSUPPORTED', url: 'https://example.com' }),
    /Unsupported relay task type/
  );

  await assert.rejects(
    () => executeRelayTask({ type: 'FETCH_JOB_PAGE', url: 'ftp://bad' }),
    /Task URL must be valid HTTP/
  );
});

test('relay: executes FETCH_JOB_PAGE and decants HTML and JSON-LD', async () => {
  const mockHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@type": "JobPosting",
            "title": "Lead Site Reliability Engineer",
            "hiringOrganization": { "name": "Stark Industries" }
          }
        </script>
      </head>
      <body>
        <nav><a href="/">Home</a></nav>
        <main>
          <h1>Lead Site Reliability Engineer</h1>
          <p>We are seeking an experienced SRE to scale our multi-region Kubernetes platform.</p>
          <ul>
            <li>Maintain 99.99% SLA</li>
            <li>Lead incident response</li>
          </ul>
        </main>
        <footer>Copyright 2026</footer>
      </body>
    </html>
  `;

  const mockFetch = async (url) => {
    return {
      ok: true,
      status: 200,
      text: async () => mockHtml,
    };
  };

  const result = await executeRelayTask(
    { type: 'FETCH_JOB_PAGE', url: 'https://stark.test/careers/sre' },
    { fetchImpl: mockFetch }
  );

  assert.equal(result.title, 'Lead Site Reliability Engineer');
  assert.equal(result.company, 'Stark Industries');
  assert.ok(result.description.includes('scale our multi-region Kubernetes platform'));
  assert.ok(result.description.includes('Maintain 99.99% SLA'));
  assert.ok(!result.description.includes('Copyright 2026'));
});

test('relay: executes CHECK_LIVENESS using ATS liveness engine', async () => {
  const mockCtx = {
    fetchResponse: async (url) => {
      // 200 OK -> active
      return { status: 200 };
    },
  };

  const result = await executeRelayTask(
    { type: 'CHECK_LIVENESS', url: 'https://boards.greenhouse.io/acme/jobs/12345' },
    { httpCtx: mockCtx }
  );

  assert.equal(result.liveness, 'active');
});

test('relay: pollAndExecuteOnce leases, executes, and fulfills task', async () => {
  const requests = [];

  const mockFetch = async (url, opts = {}) => {
    requests.push({ url, opts });

    if (url.endsWith('/api/v1/relay/tasks/lease')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          task: {
            id: 'task_abc123',
            type: 'FETCH_JOB_PAGE',
            url: 'https://acme.test/job/42',
            leaseToken: 'lease_xyz789',
          },
        }),
      };
    }

    if (url === 'https://acme.test/job/42') {
      return {
        ok: true,
        status: 200,
        text: async () => '<h1>Senior Developer</h1><p>Join our team to build scalable microservices.</p>',
      };
    }

    if (url.includes('/fulfill')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, status: 'completed' }),
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const outcome = await pollAndExecuteOnce({
    serverUrl: 'http://localhost:8080',
    apiKey: 'my-api-key',
    fetchImpl: mockFetch,
  });

  assert.equal(outcome.handled, true);
  assert.equal(outcome.taskId, 'task_abc123');
  assert.equal(outcome.success, true);

  // Verify fulfill request payload
  const fulfillCall = requests.find((r) => r.url.includes('/fulfill'));
  assert.ok(fulfillCall);
  const payload = JSON.parse(fulfillCall.opts.body);
  assert.equal(payload.leaseToken, 'lease_xyz789');
  assert.ok(payload.result.description.includes('Join our team to build scalable microservices'));
});
