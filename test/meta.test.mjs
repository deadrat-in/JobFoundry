import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');

test('workspaces declared in root package.json resolve to directories', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  assert.ok(Array.isArray(pkg.workspaces), 'root package.json must declare workspaces');
  for (const ws of pkg.workspaces) {
    assert.ok(existsSync(resolve(ROOT, ws)), `workspace dir missing: ${ws}`);
    assert.ok(
      existsSync(resolve(ROOT, ws, 'package.json')),
      `workspace package.json missing: ${ws}`
    );
  }
});

test('check-meta exits 0 on a valid repo', () => {
  const out = execFileSync(process.execPath, [resolve(ROOT, 'scripts/check-meta.mjs')], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  assert.match(out, /check-meta OK/);
});
