import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { openDb } from '../src/db/index.mjs';
import { migrate } from '../src/db/migrate.mjs';

test('openDb migrates an in-memory DB to the full multi-tenant schema', () => {
  const db = openDb({ path: ':memory:' });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name)
      .sort();
    assert.deepEqual(tables, ['jobs', 'user_jobs', 'user_resumes', 'users'].sort());

    // Verify users table
    const userCols = db.prepare('PRAGMA table_info(users)').all();
    assert.ok(userCols.find((c) => c.name === 'id' && c.pk === 1));
    assert.ok(userCols.find((c) => c.name === 'email' && c.notnull === 1));
    assert.ok(userCols.find((c) => c.name === 'password_hash' && c.notnull === 1));
    assert.ok(userCols.find((c) => c.name === 'api_key' && c.notnull === 1));

    // Verify user_resumes table
    const resumeCols = db.prepare('PRAGMA table_info(user_resumes)').all();
    assert.ok(resumeCols.find((c) => c.name === 'id' && c.pk === 1));
    assert.ok(resumeCols.find((c) => c.name === 'user_id' && c.notnull === 1));
    assert.ok(resumeCols.find((c) => c.name === 'resume_json' && c.notnull === 1));
    assert.ok(resumeCols.find((c) => c.name === 'is_active' && c.notnull === 1));

    // Verify user_jobs table
    const userJobCols = db.prepare('PRAGMA table_info(user_jobs)').all();
    assert.ok(userJobCols.find((c) => c.name === 'id' && c.pk === 1));
    assert.ok(userJobCols.find((c) => c.name === 'user_id' && c.notnull === 1));
    assert.ok(userJobCols.find((c) => c.name === 'job_id' && c.notnull === 1));
    assert.ok(userJobCols.find((c) => c.name === 'status' && c.notnull === 1));

    // Verify idx_jobs_fingerprint index
    const indices = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_jobs_fingerprint'"
      )
      .all();
    assert.equal(indices.length, 1);
  } finally {
    db.close();
  }
});

test('foreign key cascade deletes user_jobs and user_resumes on user delete', () => {
  const db = openDb({ path: ':memory:' });
  try {
    const now = Date.now();
    db.prepare(
      'INSERT INTO users (id, email, password_hash, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('u1', 'test@example.com', 'hash', 'key-1', now, now);

    db.prepare(
      'INSERT INTO jobs (id, title, company, url, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('j1', 'Engineer', 'Acme', 'https://acme.test/job1', 'greenhouse', now, now);

    db.prepare(
      'INSERT INTO user_resumes (id, user_id, title, resume_json, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('r1', 'u1', 'My Resume', '{"basics":{"name":"Test"}}', 1, now, now);

    db.prepare(
      'INSERT INTO user_jobs (id, user_id, job_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('uj1', 'u1', 'j1', 'new', now, now);

    assert.equal(db.prepare('SELECT COUNT(*) as n FROM user_resumes').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) as n FROM user_jobs').get().n, 1);

    // Delete user -> should cascade
    db.prepare('DELETE FROM users WHERE id = ?').run('u1');
    assert.equal(db.prepare('SELECT COUNT(*) as n FROM user_resumes').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) as n FROM user_jobs').get().n, 0);
    // Job in catalog remains
    assert.equal(db.prepare('SELECT COUNT(*) as n FROM jobs').get().n, 1);
  } finally {
    db.close();
  }
});

test('migrate is idempotent', () => {
  const db = new Database(':memory:');
  try {
    assert.doesNotThrow(() => migrate(db));
    assert.doesNotThrow(() => migrate(db));
    const count = db
      .prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
      )
      .get();
    assert.equal(count.n, 4);
  } finally {
    db.close();
  }
});
