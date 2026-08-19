import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const SCHEMA_URL = new URL('./resume-schema.json', import.meta.url);
const resumeSchema = JSON.parse(readFileSync(SCHEMA_URL, 'utf8'));

const AjvClass = Ajv.default || Ajv;
const addFormatsFn = addFormats.default || addFormats;

const ajv = new AjvClass({ strict: false, allErrors: true, validateSchema: false });
addFormatsFn(ajv);
const schemaValidator = ajv.compile(resumeSchema);

export function validateResumeJson(input) {
  let parsed;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      throw new Error(`Invalid JSON format: ${e.message}`);
    }
  } else if (typeof input === 'object' && input !== null) {
    parsed = input;
  } else {
    throw new Error('Resume must be a JSON string or object');
  }

  // Schema validation against JSON Resume v1.0.0
  const isValid = schemaValidator(parsed);
  if (!isValid && schemaValidator.errors) {
    const errorDetails = schemaValidator.errors
      .map((err) => `${err.instancePath || '/'} ${err.message}`)
      .join('; ');
    throw new Error(`JSON Resume validation failed: ${errorDetails}`);
  }

  return parsed;
}

export function getUserResumes(db, userId) {
  return db
    .prepare(
      'SELECT id, user_id, title, resume_json, is_active, created_at, updated_at FROM user_resumes WHERE user_id = ? ORDER BY is_active DESC, updated_at DESC'
    )
    .all(userId)
    .map((r) => ({
      ...r,
      resume: JSON.parse(r.resume_json),
      isActive: Boolean(r.is_active),
    }));
}

export function getActiveResume(db, userId) {
  const row = db
    .prepare(
      'SELECT id, user_id, title, resume_json, is_active, created_at, updated_at FROM user_resumes WHERE user_id = ? AND is_active = 1 LIMIT 1'
    )
    .get(userId);

  if (!row) return null;
  return {
    ...row,
    resume: JSON.parse(row.resume_json),
    isActive: true,
  };
}

export function saveUserResume(
  db,
  { userId, title = 'Master Resume', resumeJson, setActive = true }
) {
  const validated = validateResumeJson(resumeJson);
  const jsonStr = JSON.stringify(validated);
  const now = Date.now();
  const id = `res_${randomUUID()}`;

  db.transaction(() => {
    if (setActive) {
      db.prepare('UPDATE user_resumes SET is_active = 0, updated_at = ? WHERE user_id = ?').run(
        now,
        userId
      );
    }
    db.prepare(
      'INSERT INTO user_resumes (id, user_id, title, resume_json, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, userId, title, jsonStr, setActive ? 1 : 0, now, now);
  })();

  return {
    id,
    userId,
    title,
    resume: validated,
    isActive: setActive,
    createdAt: now,
    updatedAt: now,
  };
}

export function setActiveResume(db, { userId, resumeId }) {
  const now = Date.now();
  let updated = false;

  db.transaction(() => {
    db.prepare('UPDATE user_resumes SET is_active = 0, updated_at = ? WHERE user_id = ?').run(
      now,
      userId
    );
    const res = db
      .prepare('UPDATE user_resumes SET is_active = 1, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(now, resumeId, userId);
    updated = res.changes > 0;
  })();

  return updated;
}

export function deleteUserResume(db, { userId, resumeId }) {
  const res = db
    .prepare('DELETE FROM user_resumes WHERE id = ? AND user_id = ?')
    .run(resumeId, userId);
  return res.changes > 0;
}
