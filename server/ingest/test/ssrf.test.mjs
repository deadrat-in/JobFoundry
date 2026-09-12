import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIp, assertSafeOutboundUrl, safeFetch } from '../src/security/ssrf.mjs';

test('isBlockedIp flags private/loopback/link-local/reserved ranges', () => {
  const blocked = [
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.1',
    '192.168.0.1',
    '192.168.255.255',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:192.168.0.1',
    '::ffff:169.254.169.254',
    '::', // unspecified
    '::127.0.0.1', // IPv4-compatible
    '::192.168.1.1',
    '2001:db8::1',
    'fc00::1',
    'fd12:3456:789a::1',
    'fe80::1',
    'ff02::1',
    // Unparseable garbage is treated as blocked
    'not-an-ip',
    '',
  ];
  for (const ip of blocked) {
    assert.equal(isBlockedIp(ip), true, `expected ${ip} to be blocked`);
  }
});

test('isBlockedIp allows public IPs and IPv4-mapped public IPs', () => {
  const allowed = [
    '1.1.1.1',
    '8.8.8.8',
    '93.184.216.34',
    '172.32.0.1', // just outside 172.16.0.0/12
    '192.169.0.1', // outside 192.168.0.0/16
    '100.128.0.1', // just outside 100.64.0.0/10
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '2001:4860:4860::8888',
  ];
  for (const ip of allowed) {
    assert.equal(isBlockedIp(ip), false, `expected ${ip} to be allowed`);
  }
});

test('assertSafeOutboundUrl allows operator-trusted internal gateways', async () => {
  await assertSafeOutboundUrl('http://127.0.0.1:11434/v1');
  await assertSafeOutboundUrl('http://localhost:11434/v1');

  // ALLOWED_LLM_BASES extends the trusted set
  const env = { ALLOWED_LLM_BASES: 'http://10.99.0.5:1234, https://gateway.internal:8443' };
  await assertSafeOutboundUrl('http://10.99.0.5:1234/v1', env);
  await assertSafeOutboundUrl('https://gateway.internal:8443/v1', env);
});

test('assertSafeOutboundUrl accepts public IP literals (no DNS needed)', async () => {
  await assertSafeOutboundUrl('https://8.8.8.8/v1');
  await assertSafeOutboundUrl('https://1.1.1.1:8080/path');
});

test('assertSafeOutboundUrl requires https for public endpoints', async () => {
  // A public http endpoint could leak the API key in cleartext — only
  // operator-trusted internal gateways may use http.
  await assert.rejects(
    assertSafeOutboundUrl('http://1.1.1.1:8080/path'),
    /operator-trusted internal gateways/
  );
  await assert.rejects(
    assertSafeOutboundUrl('http://8.8.8.8/v1', {}),
    /operator-trusted internal gateways/
  );

  // TLS-terminated endpoints remain fine
  await assertSafeOutboundUrl('https://8.8.8.8/v1');
});

test('assertSafeOutboundUrl rejects blocked IP literals', async () => {
  await assert.rejects(assertSafeOutboundUrl('https://127.0.0.1:8080'), /private\/blocked IP/);
  await assert.rejects(assertSafeOutboundUrl('https://10.0.0.1/'), /private\/blocked IP/);
  await assert.rejects(
    assertSafeOutboundUrl('https://169.254.169.254/latest/meta-data/'),
    /private\/blocked IP/
  );
  await assert.rejects(assertSafeOutboundUrl('https://[::1]/'), /private\/blocked IP/);
  await assert.rejects(
    assertSafeOutboundUrl('https://[::ffff:192.168.1.1]/'),
    /private\/blocked IP/
  );
  // IPv4-compatible IPv6 (::/96) forms inherit IPv4 blocking
  await assert.rejects(assertSafeOutboundUrl('https://[::127.0.0.1]/'), /private\/blocked IP/);
  await assert.rejects(assertSafeOutboundUrl('https://[::192.168.1.1]/'), /private\/blocked IP/);
});

test('assertSafeOutboundUrl rejects structural abuse', async () => {
  await assert.rejects(assertSafeOutboundUrl(''), /Empty URL/);
  await assert.rejects(assertSafeOutboundUrl('ftp://example.com/'), /http or https/);
  await assert.rejects(assertSafeOutboundUrl('file:///etc/passwd'), /http or https/);
  await assert.rejects(
    assertSafeOutboundUrl('https://user:pass@example.com/'),
    /must not contain credentials/
  );
  await assert.rejects(assertSafeOutboundUrl('not a url'), /Invalid URL|Unable to determine/);
});

test('assertSafeOutboundUrl blocks hostnames resolving to private IPs', async () => {
  // .invalid is guaranteed not to resolve (RFC 6761)
  await assert.rejects(
    assertSafeOutboundUrl('https://definitely-not-a-real-host.invalid/'),
    /Unable to resolve/
  );
});

test('safeFetch strips bearer credentials on redirect hops', async () => {
  const { createServer } = await import('node:http');

  const interceptor = createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined, 'Authorization must be stripped');
    assert.equal(req.headers.cookie, undefined, 'Cookie must be stripped');
    assert.equal(req.headers['x-request-id'], 'abc-123', 'non-credential headers survive');
    res.writeHead(200);
    res.end('landed');
  });
  await new Promise((resolve) => interceptor.listen(0, '127.0.0.1', resolve));
  const targetPort = interceptor.address().port;

  const source = createServer((_req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/land` });
    res.end();
  });
  await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
  const sourcePort = source.address().port;

  const env = {
    ALLOWED_LLM_BASES: `http://127.0.0.1:${sourcePort},http://127.0.0.1:${targetPort}`,
  };

  const resp = await safeFetch(
    `http://127.0.0.1:${sourcePort}/hop`,
    {
      headers: {
        Authorization: 'Bearer sk-or-user-secret-999',
        Cookie: 'session=topsecret',
        'X-Request-Id': 'abc-123',
      },
    },
    env
  );
  assert.equal(resp.status, 200);
  assert.equal(await resp.text(), 'landed');

  source.close();
  interceptor.close();
});

test('safeFetch re-validates every redirect hop', async () => {
  const { createServer } = await import('node:http');

  // Server on a trusted origin serving three routes:
  //   /hop  → 302 to a private (untrusted) destination
  //   /loop → 302 back to itself
  //   /land → 302 to a still-safe destination on the same origin
  const server = createServer((req, res) => {
    if (req.url === '/hop') {
      res.writeHead(302, { Location: 'https://127.0.0.1:9/private' });
      res.end();
    } else if (req.url === '/loop') {
      res.writeHead(302, { Location: '/loop' });
      res.end();
    } else if (req.url === '/land') {
      res.writeHead(200);
      res.end('landed');
    } else {
      res.writeHead(302, { Location: '/land' });
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const env = { ALLOWED_LLM_BASES: `http://127.0.0.1:${port}` };

  try {
    // Redirect to a private destination must be rejected before it is followed
    await assert.rejects(safeFetch(`http://127.0.0.1:${port}/hop`, {}, env), /private\/blocked IP/);

    // A redirect loop must be aborted after the hop cap
    await assert.rejects(safeFetch(`http://127.0.0.1:${port}/loop`, {}, env), /Too many redirects/);

    // A benign redirect to a still-safe trusted destination is followed
    const resp = await safeFetch(`http://127.0.0.1:${port}/redirect-me`, {}, env);
    assert.equal(resp.status, 200);
    assert.equal(await resp.text(), 'landed');

    // redirect: 'error' rejects if a redirect occurs
    await assert.rejects(
      safeFetch(`http://127.0.0.1:${port}/redirect-me`, { redirect: 'error' }, env),
      /Redirect blocked by policy/
    );

    // redirect: 'manual' returns the 3xx response without following
    const manualResp = await safeFetch(
      `http://127.0.0.1:${port}/redirect-me`,
      { redirect: 'manual' },
      env
    );
    assert.equal(manualResp.status, 302);
  } finally {
    server.close();
  }
});
