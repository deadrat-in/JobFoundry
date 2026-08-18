import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROVIDERS = join(EXT, 'src', 'background', 'providers');
const TESTS = join(PROVIDERS, 'tests');

const providerFiles = readdirSync(PROVIDERS)
  .filter((f) => f.endsWith('.mjs'))
  .sort();
const liftedTests = readdirSync(TESTS)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

test('vendored provider tree matches the expected file inventory', () => {
  const nonTest = providerFiles.filter((f) => f !== 'helpers.mjs');
  assert.equal(nonTest.length, 81, '81 provider modules (82 upstream minus _dns-cache.mjs)');
  assert.ok(!nonTest.includes('_dns-cache.mjs'), '_dns-cache.mjs must not be vendored');
  assert.ok(existsSync(join(PROVIDERS, '_types.js')), '_types.js present');
  assert.ok(existsSync(join(PROVIDERS, 'README.md')), 'providers README present');
  assert.ok(existsSync(join(EXT, 'src', 'background', 'user-agent.mjs')), 'user-agent.mjs present');
  const dropped = [
    'dns-cache.test.mjs',
    'dns-pacing.test.mjs',
    'scan-resolver-breaker.test.mjs',
    'title-entity-decode.test.mjs',
  ];
  assert.equal(liftedTests.length, 80, '80 lifted tests (84 upstream minus 4 Node-only)');
  for (const d of dropped) assert.ok(!liftedTests.includes(d), `${d} must be dropped`);
  assert.ok(
    liftedTests.includes('_profile-keywords.test.mjs'),
    'ported _profile-keywords test present'
  );
  assert.ok(liftedTests.includes('workday.test.mjs'), 'ported workday test present');
  assert.ok(liftedTests.includes('vdab.test.mjs'), 'ported vdab test present');
});

test('registry static index covers every provider with a unique id', async () => {
  const { providerMap } = await import(pathToFileURL(join(PROVIDERS, 'index.js')).href);
  const ids = Object.keys(providerMap);
  assert.equal(ids.length, 75, '75 provider ids in the static registry');
  assert.equal(new Set(ids).size, 75, 'provider ids are unique');
  const providerIds = new Set();
  for (const f of providerFiles) {
    if (f.startsWith('_') || f === 'helpers.mjs') continue;
    const mod = await import(pathToFileURL(join(PROVIDERS, f)).href);
    assert.equal(typeof mod.default?.id, 'string', `${f} has a string default id`);
    providerIds.add(mod.default.id);
  }
  assert.equal(providerIds.size, 75, '75 unique ids across provider modules');
  for (const id of providerIds) {
    assert.ok(id in providerMap, `registry maps ${id}`);
    assert.equal(providerMap[id].id, id, `registry entry for ${id} is the right module`);
  }
});

// The lifted tests are plain scripts (no node:test) whose failures only print
// "❌" via the vendored helpers; they never set a non-zero exit code by
// themselves. To detect a failing assertion we spawn each file in its own
// process and count the ❌ markers, exactly the way upstream test-all.mjs
// treats pass()/fail() output.
test('every lifted provider test passes (80 files, failed === 0)', async () => {
  const failures = [];
  for (const f of liftedTests) {
    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [join(TESTS, f)], {
        encoding: 'utf8',
        timeout: 120000,
      });
    } catch (err) {
      const out = String(err?.stdout ?? '');
      const errOut = String(err?.stderr ?? '');
      failures.push(`${f}: exit ${err?.status ?? 'crash'} — ${errOut || out}`);
      continue;
    }
    const failedCount = (stdout.match(/❌/g) ?? []).length;
    if (failedCount > 0) {
      failures.push(`${f}: ${failedCount} failed assertion(s)`);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});
