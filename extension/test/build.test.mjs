import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EXT = resolve(import.meta.dirname, '..');

function runBuild() {
  execFileSync(process.execPath, [resolve(EXT, 'build.mjs')], { cwd: EXT, stdio: 'pipe' });
}

function webExtLint() {
  execFileSync(
    'npx',
    ['--no-install', 'web-ext', 'lint', '--source-dir', 'dist/firefox', '--no-input'],
    { cwd: EXT, stdio: 'pipe' }
  );
}

test('build produces chrome and firefox dist with required files', () => {
  runBuild();
  for (const target of ['chrome', 'firefox']) {
    for (const file of ['background.js', 'popup.html', 'popup.js', 'popup.css', 'manifest.json']) {
      assert.ok(
        existsSync(resolve(EXT, 'dist', target, file)),
        `${target}/${file} missing after build`
      );
    }
  }
});

test('chrome manifest is MV3 with action', () => {
  runBuild();
  const manifest = JSON.parse(
    readFileSync(resolve(EXT, 'dist', 'chrome', 'manifest.json'), 'utf8')
  );
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.ok(!manifest.browser_action, 'chrome manifest must not use browser_action');
});

test('firefox manifest is MV2 with browser_action and gecko id', () => {
  runBuild();
  const manifest = JSON.parse(
    readFileSync(resolve(EXT, 'dist', 'firefox', 'manifest.json'), 'utf8')
  );
  assert.equal(manifest.manifest_version, 2);
  assert.ok(Array.isArray(manifest.background.scripts), 'mv2 background must use scripts[]');
  assert.equal(manifest.background.scripts[0], 'background.js');
  assert.equal(manifest.browser_action.default_popup, 'popup.html');
  assert.deepEqual(manifest.browser_specific_settings.gecko, { id: 'jobfoundry@local' });
  assert.ok(!manifest.action, 'firefox manifest must not use action');
});

test('web-ext lint passes on the firefox build', () => {
  runBuild();
  webExtLint();
});
