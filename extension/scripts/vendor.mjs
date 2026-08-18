// scripts/vendor.mjs — copy the career-ops provider layer into the extension.
//
// Source of truth: /Scratch/career-ops (MIT, vendored from earlier phases).
// Everything copied lands under extension/src/background so it stays inside
// the browser-runnable tree.
//
// What is copied:
//   - providers/* (all 82 *.mjs + _types.js + README.md) EXCEPT _dns-cache.mjs,
//     which is Node-only (patches node:dns at import time) and is replaced by
//     an inlined browser no-op inside the _http port.
//   - user-agent.mjs -> src/background/user-agent.mjs
//   - tests/providers/*.test.mjs EXCEPT the four tests that import Node-only
//     fixtures we deliberately do not vendor (documented in the plan):
//       dns-cache.test.mjs / dns-pacing.test.mjs   (test _dns-cache.mjs)
//       scan-resolver-breaker.test.mjs             (imports scan-ats-full.mjs)
//       title-entity-decode.test.mjs               (imports scan.mjs buildTitleFilter)
//   - tests/helpers.mjs -> providers/tests/helpers.mjs (ROOT adapted)
//   - tests/fixtures/icims-search-page.html -> src/background/tests/fixtures/
//
// Idempotent: every copy is an unconditional overwrite from the --from tree,
// so re-running always reproduces the same vendored tree. Refuses to run
// without --from <career-ops-path>.
//
// After the verbatim copy, the Node-only provider modules are replaced by the
// browser ports in scripts/ports/ (same filenames). Those ports are the
// adapted, MIT-attributed versions — see scripts/ports/README.md. The same is
// done for the three test files whose assertions target Node-only behaviour.
//
// Usage: node scripts/vendor.mjs --from /path/to/career-ops

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROVIDERS_DST = join(EXT, 'src', 'background', 'providers');
const TESTS_DST = join(PROVIDERS_DST, 'tests');
const FIXTURES_DST = join(EXT, 'src', 'background', 'tests', 'fixtures');
const PORTS = join(EXT, 'scripts', 'ports');

// _dns-cache.mjs patches node:dns at import time — impossible in a browser,
// and pointless (the browser owns its own DNS). Not vendored.
const DROP_PROVIDER_FILES = new Set(['_dns-cache.mjs']);

// Node-only provider tests whose fixtures are deliberately not vendored.
const DROP_TEST_FILES = new Set([
  'dns-cache.test.mjs',
  'dns-pacing.test.mjs',
  'scan-resolver-breaker.test.mjs',
  'title-entity-decode.test.mjs',
]);

// Provider modules that cannot run in a browser as copied. Each is replaced by
// its browser port from scripts/ports/ after the verbatim copy.
const PORTED_PROVIDERS = new Set([
  '_http.mjs',
  '_registry.mjs',
  '_profile-keywords.mjs',
  'local-parser.mjs',
  'alibaba.mjs',
]);

// Lifted tests whose assertions depend on the Node-only parts of the ports.
const PORTED_TESTS = new Set(['workday.test.mjs', '_profile-keywords.test.mjs', 'vdab.test.mjs']);

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1];
}

const from = argValue('--from');
if (!from) {
  console.error('vendor.mjs: missing required --from <career-ops-path>');
  process.exit(1);
}
const SRC = resolve(from);
for (const p of [join(SRC, 'providers'), join(SRC, 'tests', 'providers'), join(SRC, 'tests')]) {
  if (!existsSync(p)) {
    console.error(`vendor.mjs: --from tree missing expected dir: ${p}`);
    process.exit(1);
  }
}

mkdirSync(PROVIDERS_DST, { recursive: true });
mkdirSync(TESTS_DST, { recursive: true });
mkdirSync(FIXTURES_DST, { recursive: true });

function copy(fromPath, toPath) {
  copyFileSync(fromPath, toPath);
  console.log(`  vendored ${toPath.replace(EXT + '/', '')}`);
}

let providerFiles = 0;
for (const name of readdirSync(join(SRC, 'providers')).sort()) {
  if (DROP_PROVIDER_FILES.has(name)) continue;
  copy(join(SRC, 'providers', name), join(PROVIDERS_DST, name));
  providerFiles++;
}

copy(join(SRC, 'user-agent.mjs'), join(EXT, 'src', 'background', 'user-agent.mjs'));

let testFiles = 0;
for (const name of readdirSync(join(SRC, 'tests', 'providers')).sort()) {
  if (DROP_TEST_FILES.has(name)) continue;
  copy(join(SRC, 'tests', 'providers', name), join(TESTS_DST, name));
  testFiles++;
}

const helpersSrc = join(SRC, 'tests', 'helpers.mjs');
const helpersDst = join(PROVIDERS_DST, 'helpers.mjs');
copy(helpersSrc, helpersDst);
// Vendored helpers live at providers/helpers.mjs (next to the providers, so
// tests/providers/*.test.mjs resolve '../helpers.mjs'). Upstream helpers sat
// at tests/helpers.mjs with ROOT = repo root; here the providers' parent
// (src/background) is the root, so join(ROOT, 'providers/<name>.mjs') still
// resolves and join(ROOT, 'tests/fixtures/<name>') hits the vendored fixtures.
// No textual ROOT change is needed: the upstream comment is dropped because
// __dirname already puts ROOT at src/background.

const fixture = join(SRC, 'tests', 'fixtures', 'icims-search-page.html');
if (existsSync(fixture)) copy(fixture, join(FIXTURES_DST, 'icims-search-page.html'));

for (const name of PORTED_PROVIDERS) {
  const port = join(PORTS, name);
  if (!existsSync(port)) {
    console.error(`vendor.mjs: missing browser port: ${port}`);
    process.exit(1);
  }
  copy(port, join(PROVIDERS_DST, name));
}

for (const name of PORTED_TESTS) {
  const port = join(PORTS, 'tests', name);
  if (!existsSync(port)) {
    console.error(`vendor.mjs: missing test port: ${port}`);
    process.exit(1);
  }
  copy(port, join(TESTS_DST, name));
}

console.log(
  `\nvendor.mjs: ${providerFiles} provider-dir files (84 total with user-agent.mjs), ` +
    `${testFiles} lifted tests (${DROP_TEST_FILES.size} Node-only tests dropped)`
);
