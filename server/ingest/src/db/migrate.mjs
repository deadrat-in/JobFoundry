import { readFileSync } from 'node:fs';

const SCHEMA_SQL = new URL('./schema.sql', import.meta.url);

export function migrate(db) {
  const sql = readFileSync(SCHEMA_SQL, 'utf8');
  db.exec(sql);
  try {
    db.exec('ALTER TABLE jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0');
  } catch {}
  try {
    db.exec('ALTER TABLE user_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0');
  } catch {}
}
