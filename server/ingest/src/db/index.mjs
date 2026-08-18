import Database from 'better-sqlite3';
import { migrate } from './migrate.mjs';

export function openDb({ path }) {
  const db = new Database(path);
  if (path !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  migrate(db);
  return db;
}
