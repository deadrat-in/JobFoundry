import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIp, assertSafeOutboundUrl } from '../src/security/ssrf.mjs';

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
  await assertSafeOutboundUrl('http://127.0.0.1:8318/v1/chat/completions');
  await assertSafeOutboundUrl('http://localhost:8318/path');
  await assertSafeOutboundUrl('http://127.0.0.1:11434/v1');
  await assertSafeOutboundUrl('http://localhost:11434/v1');

  // ALLOWED_LLM_BASES extends the trusted set
  const env = { ALLOWED_LLM_BASES: 'http://10.99.0.5:1234, https://gateway.internal:8443' };
  await assertSafeOutboundUrl('http://10.99.0.5:1234/v1', env);
  await assertSafeOutboundUrl('https://gateway.internal:8443/v1', env);
});

test('assertSafeOutboundUrl accepts public IP literals (no DNS needed)', async () => {
  await assertSafeOutboundUrl('https://8.8.8.8/v1');
  await assertSafeOutboundUrl('http://1.1.1.1:8080/path');
});

test('assertSafeOutboundUrl rejects blocked IP literals', async () => {
  await assert.rejects(assertSafeOutboundUrl('http://127.0.0.1:8080'), /private\/blocked IP/);
  await assert.rejects(assertSafeOutboundUrl('https://10.0.0.1/'), /private\/blocked IP/);
  await assert.rejects(
    assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/'),
    /private\/blocked IP/
  );
  await assert.rejects(assertSafeOutboundUrl('http://[::1]:8080/'), /private\/blocked IP/);
  await assert.rejects(
    assertSafeOutboundUrl('http://[::ffff:192.168.1.1]:8080/'),
    /private\/blocked IP/
  );
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
