import { fingerprintText } from './dedup/fingerprint-core.mjs';

export function fingerprintFor(job) {
  return fingerprintText(String(job?.description ?? ''));
}

const INSERT_SQL = `
  INSERT INTO jobs (
    id, title, company, location, url, source, posted_at, description,
    fingerprint, liveness, fit_score, fit_notes, status, tailored_resume_id,
    created_at, updated_at
  ) VALUES (
    @id, @title, @company, @location, @url, @source, @posted_at, @description,
    @fingerprint, @liveness, @fit_score, @fit_notes, @status, @tailored_resume_id,
    @created_at, @updated_at
  ) ON CONFLICT(url) DO NOTHING
`;

export function insertIfNew(db, row) {
  let res;
  try {
    res = db.prepare(INSERT_SQL).run(row);
  } catch (err) {
    // Same content arriving from a different agency URL collides on the
    // fingerprint-derived id, not on url: that is still one authoritative job.
    if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      const existing = db.prepare('SELECT id FROM jobs WHERE id = ?').get(row.id);
      return { id: existing?.id ?? row.id, deduped: true };
    }
    throw err;
  }
  if (res.changes === 1) return { id: row.id, deduped: false };
  const existing = db.prepare('SELECT id FROM jobs WHERE url = ?').get(row.url);
  return { id: existing?.id ?? row.id, deduped: true };
}
