import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb } from '../src/db/index.mjs';
import { migrate } from '../src/db/migrate.mjs';

const EXPECTED_COLUMNS = [
  ['id', 'TEXT', 0],
  ['title', 'TEXT', 1],
  ['company', 'TEXT', 1],
  ['location', 'TEXT', 0],
  ['url', 'TEXT', 1],
  ['source', 'TEXT', 1],
  ['posted_at', 'INTEGER', 0],
  ['description', 'TEXT', 0],
  ['fingerprint', 'TEXT', 0],
  ['liveness', 'TEXT', 1],
  ['fit_score', 'INTEGER', 0],
  ['fit_notes', 'TEXT', 0],
  ['status', 'TEXT', 1],
  ['tailored_resume_id', 'TEXT', 0],
  ['created_at', 'INTEGER', 1],
  ['updated_at', 'INTEGER', 1],
];

test('openDb migrates an in-memory DB to the exact jobs schema', () => {
  const db = openDb({ path: ':memory:' });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name);
    assert.deepEqual(tables, ['jobs']);

    const cols = db.prepare('PRAGMA table_info(jobs)').all();
    assert.equal(cols.length, EXPECTED_COLUMNS.length);
    for (const [name, type, notnull] of EXPECTED_COLUMNS) {
      const col = cols.find((c) => c.name === name);
      assert.ok(col, `missing column ${name}`);
      assert.equal(col.type, type, `column ${name} type`);
      assert.equal(col.notnull, notnull, `column ${name} nullability`);
      if (name === 'id') assert.equal(col.pk, 1, 'id must be the primary key');
      else assert.equal(col.pk, 0, `${name} must not be primary key`);
    }

    const liveness = cols.find((c) => c.name === 'liveness');
    assert.equal(String(liveness.dflt_value).replace(/'/g, ''), 'unknown');
    const status = cols.find((c) => c.name === 'status');
    assert.equal(String(status.dflt_value).replace(/'/g, ''), 'new');
  } finally {
    db.close();
  }
});

test('url has a unique index', () => {
  const db = openDb({ path: ':memory:' });
  try {
    const indexes = db.prepare('PRAGMA index_list(jobs)').all();
    const unique = indexes.find((i) => i.unique === 1);
    assert.ok(unique, 'expected a unique index on jobs');
    const cols = db.prepare(`PRAGMA index_info("${unique.name}")`).all();
    assert.deepEqual(
      cols.map((c) => c.name),
      ['url']
    );
  } finally {
    db.close();
  }
});

test('migrate is idempotent (runs twice without error)', () => {
  const db = new Database(':memory:');
  try {
    assert.doesNotThrow(() => migrate(db));
    assert.doesNotThrow(() => migrate(db));
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'jobs'")
      .get();
    assert.equal(count.n, 1);
  } finally {
    db.close();
  }
});

test('openDb on a file path creates a persistent DB and reopens cleanly', (t) => {
  const path = join(tmpdir(), `jobfoundry-schema-test-${process.pid}.db`);
  t.after(() => {
    try {
      unlinkSync(path);
    } catch {
      // temp file may already be gone
    }
  });

  const first = openDb({ path });
  first
    .prepare(
      "INSERT INTO jobs (id, title, company, url, source, created_at, updated_at) VALUES ('a', 't', 'c', 'https://x.test/1', 'test', 1, 1)"
    )
    .run();
  first.close();

  const second = openDb({ path });
  const row = second.prepare('SELECT * FROM jobs WHERE id = ?').get('a');
  assert.equal(row.url, 'https://x.test/1');
  second.close();
});
