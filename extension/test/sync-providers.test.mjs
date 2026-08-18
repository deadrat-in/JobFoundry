import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH_CAREER_OPS = '/home/anu/Workspace/Public/Job/Scratch/career-ops';

const fromExists = existsSync(join(SCRATCH_CAREER_OPS, 'providers'));

function run(args, { ok } = {}) {
  let out = '';
  try {
    out = execFileSync(process.execPath, args, { encoding: 'utf8' });
  } catch (err) {
    if (ok) throw err;
    out = String(err?.stdout ?? '') + String(err?.stderr ?? '');
  }
  return out;
}

test('sync-providers requires --from and fails loudly without it', () => {
  const out = run([join(EXT, 'scripts', 'sync-providers.mjs')]);
  assert.match(out, /missing required --from/);
});

test(
  'sync-providers detects drift by copying a stray provider into the tree',
  { skip: !fromExists },
  () => {
    const stray = join(EXT, 'src', 'background', 'providers', '_sync-providers-stray-probe.mjs');
    try {
      // A local-only file that upstream does not have must be reported as orphan.
      // (Add a file, run the check, expect a failure naming it, then remove it.)
      // Use an existing verbatim file's bytes so the probe itself is inert.
      copyFileSync(join(EXT, 'src', 'background', 'providers', '4dayweek.mjs'), stray);
      const out = run([join(EXT, 'scripts', 'sync-providers.mjs'), '--from', SCRATCH_CAREER_OPS], {
        ok: false,
      });
      assert.match(out, /orphan \(not upstream\): _sync-providers-stray-probe\.mjs/);
    } finally {
      rmSync(stray, { force: true });
    }
  }
);

test('sync-providers reports in sync for the vendored tree', { skip: !fromExists }, () => {
  const out = run([join(EXT, 'scripts', 'sync-providers.mjs'), '--from', SCRATCH_CAREER_OPS]);
  assert.match(out, /in sync/);
  assert.match(out, /not vendored \(expected\): _dns-cache\.mjs/);
});
