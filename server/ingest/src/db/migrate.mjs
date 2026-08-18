import { readFileSync } from 'node:fs';

const SCHEMA_SQL = new URL('./schema.sql', import.meta.url);

export function migrate(db) {
  const sql = readFileSync(SCHEMA_SQL, 'utf8');
  db.exec(sql);
}
