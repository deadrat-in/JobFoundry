import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EXT = resolve(import.meta.dirname, '..');

function runBuild(args = ['build']) {
  execFileSync('npx', ['wxt', ...args], { cwd: EXT, stdio: 'pipe' });
}

test('wxt build produces chrome-mv3 and firefox-mv3 dist with required files', () => {
  runBuild(['build']);
  runBuild(['build', '-b', 'firefox']);

  for (const target of ['chrome-mv3', 'firefox-mv3']) {
    for (const file of [
      'background.js',
      'popup.html',
      'sidepanel.html',
      'content-scripts/content.js',
      'manifest.json',
    ]) {
      assert.ok(
        existsSync(resolve(EXT, '.output', target, file)),
        `${target}/${file} missing after build`
      );
    }
  }
});

test('chrome manifest is MV3 with action, side_panel, and permissions', () => {
  runBuild(['build']);
  const manifest = JSON.parse(
    readFileSync(resolve(EXT, '.output', 'chrome-mv3', 'manifest.json'), 'utf8')
  );
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.side_panel?.default_path, 'sidepanel.html');
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.ok(manifest.commands?.['open-side-panel']);
});

test('firefox manifest is MV3 with sidebar_action, commands, and valid permissions', () => {
  runBuild(['build', '-b', 'firefox']);
  const manifest = JSON.parse(
    readFileSync(resolve(EXT, '.output', 'firefox-mv3', 'manifest.json'), 'utf8')
  );
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.sidebar_action?.default_panel, 'sidepanel.html');
  assert.equal(
    manifest.permissions.includes('sidePanel'),
    false,
    'Firefox must not include Chrome-only sidePanel permission'
  );
  assert.ok(manifest.commands?._execute_sidebar_action);
  assert.ok(manifest.browser_specific_settings?.gecko?.id);
});

test('bundled background.js contains providers and no node: builtins', () => {
  runBuild(['build']);
  const js = readFileSync(resolve(EXT, '.output', 'chrome-mv3', 'background.js'), 'utf8');
  assert.ok(js.includes('greenhouse'), 'providers are bundled in background.js');
  const nodeBuiltins = js.match(/from\s*"node:[^"]+"/g) ?? [];
  assert.deepEqual(nodeBuiltins, [], 'bundle must not import node: builtins');
});
