#!/usr/bin/env node
// check-meta.mjs — asserts repo identity files exist with required content.
// Exit code 0 = all checks pass. This is the test for Task 00.1.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(name) {
  const path = resolve(ROOT, name);
  if (!existsSync(path)) {
    failures.push(`missing file: ${name}`);
    return '';
  }
  return readFileSync(path, 'utf8');
}

const license = read('LICENSE');
assert(
  /GNU AFFERO GENERAL PUBLIC LICENSE/.test(license),
  'LICENSE must be AGPL (GNU Affero General Public License)'
);
assert(/Version 3/.test(license), 'LICENSE must be AGPL version 3');

const readme = read('README.md');
assert(readme.includes('JobFoundry'), 'README.md must mention the project name JobFoundry');
assert(
  readme.includes('ARCHITECTURE.md'),
  'README.md must link to ARCHITECTURE.md (where the invariant lives)'
);

// The architectural invariant lives in ARCHITECTURE.md — not in marketing
// copy. README links there; the canonical wording is enforced here.
// Comparison is whitespace-insensitive so formatters can't break it.
const architecture = read('ARCHITECTURE.md');
const INVARIANT =
  "The JobFoundry server never performs outbound job-board scraping. All scraping and job-board HTTP requests originate from the user's browser extension.";
const normalized = (s) => s.replace(/>/g, '').replace(/\s+/g, ' ');
assert(
  normalized(architecture).includes(normalized(INVARIANT)),
  'ARCHITECTURE.md must contain the architectural invariant verbatim'
);

if (failures.length > 0) {
  console.error('check-meta FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('check-meta OK: LICENSE + README present and correct');
