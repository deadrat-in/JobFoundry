import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const INDEX = resolve(ROOT, 'src/index.mjs');

test('index.mjs boots, serves /health, and exits cleanly on SIGTERM', async () => {
  const proc = spawn(process.execPath, [INDEX], {
    cwd: ROOT,
    env: { ...process.env, PORT: '0', API_KEYS: 'testkey', DB_PATH: ':memory:' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const url = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for listen line')), 10000);
    const onData = (buf) => {
      output += buf.toString();
      const m = output.match(/ingest listening on (http:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolveUrl(m[1]);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', () => reject(new Error(`process exited early:\n${output}`)));
  });

  try {
    const res = await fetch(`${url}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    proc.kill('SIGTERM');
  }

  const exitCode = await new Promise((resolveExit) => proc.on('exit', resolveExit));
  assert.equal(exitCode, 0, `expected clean exit, stderr:\n${output}`);
});
