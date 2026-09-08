import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeRelayTask, pollAndExecuteOnce } from '../src/background/relay.js';
import { fetchWithSafeRedirects } from '../src/background/safe-url.js';

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

  const mockFetch = async () => {
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
    fetchResponse: async () => {
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
        text: async () =>
          '<h1>Senior Developer</h1><p>Join our team to build scalable microservices.</p>',
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

test('relay: rejects direct private, loopback, and metadata network targets', async () => {
  const privateUrls = [
    'http://localhost:8080/admin',
    'http://127.0.0.1:8080/secret',
    'http://127.1.2.3/internal',
    'http://10.0.0.1/network',
    'http://172.16.0.5/api',
    'http://192.168.1.1/router',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/root',
    'http://[::ffff:127.0.0.1]/secret',
    'http://[::ffff:7f00:1]/secret',
    'http://[::ffff:169.254.169.254]/meta-data',
    'http://my-service.local/dashboard',
    'http://internal-host/jobs',
    'http://user:pass@public-job.test/job',
    'http://public-job.test:22/ssh',
  ];

  for (const url of privateUrls) {
    await assert.rejects(
      () => executeRelayTask({ type: 'FETCH_JOB_PAGE', url }),
      /Destination forbidden|Invalid URL|Userinfo/
    );
  }
});

test('relay: rejects domain names that resolve to private IP addresses (DNS rebinding guard)', async () => {
  const mockLookup = async (hostname) => {
    if (hostname === 'rebind.evil.test') {
      return ['127.0.0.1'];
    }
    if (hostname === 'metadata.evil.test') {
      return ['169.254.169.254'];
    }
    return ['93.184.216.34']; // public IP
  };

  await assert.rejects(
    () =>
      executeRelayTask(
        { type: 'FETCH_JOB_PAGE', url: 'https://rebind.evil.test/job/1' },
        { lookupImpl: mockLookup }
      ),
    /resolves to private\/reserved IP "127.0.0.1"/
  );

  await assert.rejects(
    () =>
      executeRelayTask(
        { type: 'FETCH_JOB_PAGE', url: 'https://metadata.evil.test/job/1' },
        { lookupImpl: mockLookup }
      ),
    /resolves to private\/reserved IP "169.254.169.254"/
  );
});

test('relay: blocks redirects targeting private network destinations', async () => {
  const mockFetch = async (url) => {
    if (url === 'https://public-board.test/job/redirect-loopback') {
      return {
        status: 302,
        headers: new Headers({ location: 'http://127.0.0.1:8080/internal' }),
      };
    }
    if (url === 'https://public-board.test/job/redirect-metadata') {
      return {
        status: 301,
        headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data' }),
      };
    }
    throw new Error(`Unexpected fetch to ${url}`);
  };

  await assert.rejects(
    () =>
      executeRelayTask(
        { type: 'FETCH_JOB_PAGE', url: 'https://public-board.test/job/redirect-loopback' },
        { fetchImpl: mockFetch, lookupImpl: async () => ['93.184.216.34'] }
      ),
    /Destination forbidden: "127.0.0.1" is a private or reserved IP address/
  );

  await assert.rejects(
    () =>
      executeRelayTask(
        { type: 'FETCH_JOB_PAGE', url: 'https://public-board.test/job/redirect-metadata' },
        { fetchImpl: mockFetch, lookupImpl: async () => ['93.184.216.34'] }
      ),
    /Destination forbidden: "169.254.169.254" is a private or reserved IP address/
  );
});

test('relay: safely follows public redirects and returns extracted content', async () => {
  const mockFetch = async (url) => {
    if (url === 'https://initial-company.test/careers/sre') {
      return {
        status: 302,
        headers: new Headers({ location: 'https://final-ats.test/jobs/42' }),
      };
    }
    if (url === 'https://final-ats.test/jobs/42') {
      return {
        ok: true,
        status: 200,
        text: async () => '<h1>Senior SRE</h1><p>Public career opportunity.</p>',
      };
    }
    throw new Error(`Unexpected fetch to ${url}`);
  };

  const result = await executeRelayTask(
    { type: 'FETCH_JOB_PAGE', url: 'https://initial-company.test/careers/sre' },
    { fetchImpl: mockFetch, lookupImpl: async () => ['93.184.216.34'] }
  );

  assert.ok(result.description.includes('Public career opportunity'));
});

test('relay: aborts fetch when timeout is reached', async () => {
  const hangingFetch = async (url, { signal } = {}) => {
    return new Promise((_, reject) => {
      if (signal) {
        signal.addEventListener('abort', () => reject(signal.reason || new Error('Aborted')));
      }
    });
  };

  await assert.rejects(
    () =>
      fetchWithSafeRedirects(
        'https://slow-ats.test/job/1',
        {},
        {
          fetchImpl: hangingFetch,
          lookupImpl: async () => ['93.184.216.34'],
          timeoutMs: 50,
        }
      ),
    /timed out after 50ms/
  );
});
