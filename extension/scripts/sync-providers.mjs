// scripts/sync-providers.mjs — drift check between the vendored provider tree
// and the career-ops source of truth.
//
// Reports (does NOT modify) files in extension/src/background/providers that:
//   - are missing from the --from tree (orphans — e.g. a file the extension
//     vendors that upstream deleted),
//   - have different content than upstream's providers/<name> (drifted —
//     except for the ported files in scripts/ports/, which legitimately differ
//     and are whitelisted),
//   - exist upstream but are not vendored (upstream added a file we don't have
//     — this includes the deliberately-dropped _dns-cache.mjs, which is
//     expected to appear here).
//
// Exit code: 0 when the tree is in sync (only expected gaps/ports differ),
// 1 when real drift or orphans are found. Run as `npm run sync:providers`,
// optionally with `--from <career-ops-path>`.
//
// The drift verdict mirrors scripts/vendor.mjs: `--from` is required and
// defaults are not assumed, so a wrong path fails loudly instead of silently
// comparing against nothing.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROVIDERS = join(EXT, 'src', 'background', 'providers');

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1];
}

const from = argValue('--from');
if (!from) {
  console.error('sync-providers.mjs: missing required --from <career-ops-path>');
  process.exit(1);
}
const SRC = resolve(from);
const UPSTREAM_PROVIDERS = join(SRC, 'providers');
if (!existsSync(UPSTREAM_PROVIDERS)) {
  console.error(`sync-providers.mjs: --from tree missing providers dir: ${UPSTREAM_PROVIDERS}`);
  process.exit(1);
}

// Provider modules whose browser port legitimately differs (see scripts/ports/).
const PORTED_PROVIDERS = new Set([
  '_http.mjs',
  '_registry.mjs',
  '_profile-keywords.mjs',
  'local-parser.mjs',
  'alibaba.mjs',
  'getonbrd.mjs',
  'hackernews.mjs',
  'himalayas.mjs',
]);

// Provider modules deliberately NOT vendored (Node-only fixtures).
const DROP_PROVIDER_FILES = new Set(['_dns-cache.mjs']);

// Local-only files in the providers dir that are NOT vendored from upstream's
// providers/: helpers.mjs is the adapted test helper (upstream keeps it at
// tests/helpers.mjs; the extension vendors it beside the providers so the
// lifted tests can resolve '../helpers.mjs'). Not a drift problem.
const LOCAL_ONLY = new Set(['helpers.mjs']);

const upstreamFiles = new Set(readdirSync(UPSTREAM_PROVIDERS).filter((f) => f.endsWith('.mjs')));
const localFiles = new Set(readdirSync(PROVIDERS).filter((f) => f.endsWith('.mjs')));

const problems = [];
const expected = [];

for (const f of localFiles) {
  if (PORTED_PROVIDERS.has(f)) continue;
  if (LOCAL_ONLY.has(f)) continue;
  if (!upstreamFiles.has(f)) {
    problems.push(`orphan (not upstream): ${f}`);
    continue;
  }
  const local = readFileSync(join(PROVIDERS, f), 'utf8');
  const upstream = readFileSync(join(UPSTREAM_PROVIDERS, f), 'utf8');
  if (local !== upstream) problems.push(`drifted from upstream: ${f}`);
}

for (const f of upstreamFiles) {
  if (DROP_PROVIDER_FILES.has(f)) {
    expected.push(`not vendored (expected): ${f}`);
    continue;
  }
  if (!localFiles.has(f)) problems.push(`missing from extension: ${f}`);
}

if (problems.length) {
  console.error(`sync-providers: ${problems.length} problem(s) in ${basename(PROVIDERS)}:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nRun: node scripts/vendor.mjs --from <career-ops-path>  (then re-generate the registry)'
  );
  process.exit(1);
}

console.log(
  `sync-providers: in sync (${localFiles.size - PORTED_PROVIDERS.size - LOCAL_ONLY.size} verbatim providers match upstream)`
);
for (const e of expected) console.log(`  ${e}`);
