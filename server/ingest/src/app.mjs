import Fastify from 'fastify';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeJob } from './jobs/normalize.mjs';
import { fingerprintFor, insertIfNew } from './jobs/dedup.mjs';
import { hashPassword, verifyPassword } from './auth/passwords.mjs';
import { createToken, verifyToken, generateApiKey } from './auth/tokens.mjs';
import {
  getUserResumes,
  getActiveResume,
  saveUserResume,
  setActiveResume,
  deleteUserResume,
} from './resumes/resumes.mjs';

function bearerToken(header) {
  if (typeof header !== 'string') return '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export function buildApp({
  db,
  apiKeys = [],
  jwtSecret = 'jobfoundry-default-jwt-secret',
  artifactsDir = './data/artifacts',
  serverUrl = '',
  logger = process.env.NODE_ENV === 'test' ? false : true,
}) {
  const legacyKeys = new Set(apiKeys ?? []);
  const app = Fastify({
    logger,
    requestIdHeader: 'x-request-id',
    genReqId: (req) =>
      req.headers['x-request-id'] || `req_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
  });

  // Handle empty JSON bodies gracefully across DELETE, PUT, POST
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body || body.length === 0) {
      done(null, {});
      return;
    }
    try {
      const json = JSON.parse(body);
      done(null, json);
    } catch (err) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // Enable CORS & propagate Request ID
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
    reply.header('x-request-id', request.id);
    if (request.method === 'OPTIONS') {
      return reply.code(200).send();
    }
  });

  // Resolve user from Authorization header
  function resolveUser(request) {
    const token = bearerToken(request.headers.authorization);
    if (!token) return null;

    // 1. Check if token is a user API key
    const userByKey = db
      .prepare('SELECT id, email, name, api_key FROM users WHERE api_key = ?')
      .get(token);
    if (userByKey) {
      return {
        id: userByKey.id,
        email: userByKey.email,
        name: userByKey.name,
        apiKey: userByKey.api_key,
      };
    }

    // 2. Check if token is a JWT
    const payload = verifyToken(token, jwtSecret);
    if (payload && payload.userId) {
      const userById = db
        .prepare('SELECT id, email, name, api_key FROM users WHERE id = ?')
        .get(payload.userId);
      if (userById) {
        return {
          id: userById.id,
          email: userById.email,
          name: userById.name,
          apiKey: userById.api_key,
        };
      }
    }

    // 3. Fallback: check legacy pre-shared API keys
    if (legacyKeys.has(token)) {
      return { id: 'legacy-admin', email: 'admin@jobfoundry.local', name: 'Admin', apiKey: token };
    }

    return null;
  }

  function authenticate(request, reply) {
    // If no static keys and no users exist yet, allow open dev access
    const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
    if (legacyKeys.size === 0 && userCount === 0) {
      request.user = {
        id: 'dev-user',
        email: 'dev@jobfoundry.local',
        name: 'Developer',
        apiKey: '',
      };
      return true;
    }

    const user = resolveUser(request);
    if (!user) {
      reply.code(401).send({ error: 'unauthorized' });
      return false;
    }
    request.user = user;
    return true;
  }

  // Health check
  app.get('/health', async () => ({ ok: true }));

  // GET /api/v1/diagnostics - Health & system telemetry
  app.get('/api/v1/diagnostics', async () => {
    const jobStats = db
      .prepare(
        `SELECT 
          COUNT(*) as total_jobs,
          SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_jobs,
          SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as applied_jobs,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_jobs,
          SUM(CASE WHEN fit_score IS NULL THEN 1 ELSE 0 END) as unscored_jobs
        FROM jobs`
      )
      .get();

    const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
    const resumeCount = db.prepare('SELECT COUNT(*) as n FROM user_resumes').get().n;

    return {
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: Date.now(),
      version: '0.1.0',
      database: {
        totalJobs: jobStats?.total_jobs || 0,
        unscoredJobs: jobStats?.unscored_jobs || 0,
        newJobs: jobStats?.new_jobs || 0,
        appliedJobs: jobStats?.applied_jobs || 0,
        rejectedJobs: jobStats?.rejected_jobs || 0,
        totalUsers: userCount || 0,
        totalResumes: resumeCount || 0,
      },
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
      },
    };
  });

  // GET /api/v1/extension/config - Seed config bundle for browser extension
  app.get('/api/v1/extension/config', async (request) => {
    const hostHeader = request.headers.host;
    const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
    const computedUrl =
      serverUrl || (hostHeader ? `${protocol}://${hostHeader}` : 'http://localhost:8080');

    const user = resolveUser(request);
    return {
      serverUrl: computedUrl,
      apiKey: user?.apiKey || (legacyKeys.size > 0 ? Array.from(legacyKeys)[0] : ''),
      scanIntervalHours: 6,
      passiveMode: true,
      activeMode: false,
      fitThreshold: 75,
      portals: {},
    };
  });

  // --- AUTHENTICATION ROUTES ---

  // POST /api/v1/auth/register
  app.post('/api/v1/auth/register', async (request, reply) => {
    const { email, password, name = '' } = request.body || {};
    if (!email || !password) {
      return reply.code(400).send({ error: 'email and password are required' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return reply.code(400).send({ error: 'password must be at least 6 characters' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existing) {
      return reply.code(409).send({ error: 'email already registered' });
    }

    const passwordHash = await hashPassword(password);
    const userId = `usr_${randomUUID()}`;
    const apiKey = generateApiKey();
    const now = Date.now();

    db.prepare(
      'INSERT INTO users (id, email, password_hash, name, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      userId,
      normalizedEmail,
      passwordHash,
      name || normalizedEmail.split('@')[0],
      apiKey,
      now,
      now
    );

    const user = {
      id: userId,
      email: normalizedEmail,
      name: name || normalizedEmail.split('@')[0],
      apiKey,
    };
    const token = createToken({ userId, email: normalizedEmail }, jwtSecret);

    return reply.code(201).send({ user, token });
  });

  // POST /api/v1/auth/login
  app.post('/api/v1/auth/login', async (request, reply) => {
    const { email, password } = request.body || {};
    if (!email || !password) {
      return reply.code(400).send({ error: 'email and password are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
    if (!userRow) {
      return reply.code(401).send({ error: 'invalid email or password' });
    }

    const isValid = await verifyPassword(password, userRow.password_hash);
    if (!isValid) {
      return reply.code(401).send({ error: 'invalid email or password' });
    }

    const user = {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      apiKey: userRow.api_key,
    };
    const token = createToken({ userId: userRow.id, email: userRow.email }, jwtSecret);

    return { user, token };
  });

  // GET /api/v1/auth/me
  app.get('/api/v1/auth/me', async (request, reply) => {
    if (!authenticate(request, reply)) return;
    return { user: request.user };
  });

  // POST /api/v1/auth/api-key/rotate
  app.post('/api/v1/auth/api-key/rotate', async (request, reply) => {
    if (!authenticate(request, reply)) return;
    const newKey = generateApiKey();
    const now = Date.now();

    db.prepare('UPDATE users SET api_key = ?, updated_at = ? WHERE id = ?').run(
      newKey,
      now,
      request.user.id
    );

    return { apiKey: newKey };
  });

  // --- RESUME MANAGEMENT ROUTES ---

  // GET /api/v1/resumes
  app.get('/api/v1/resumes', async (request, reply) => {
    if (!authenticate(request, reply)) return;
    const resumes = getUserResumes(db, request.user.id);
    return { resumes };
  });

  // GET /api/v1/resumes/active
  app.get('/api/v1/resumes/active', async (request, reply) => {
    if (!authenticate(request, reply)) return;
    const active = getActiveResume(db, request.user.id);
    return { resume: active };
  });

  // POST /api/v1/resumes
  app.post('/api/v1/resumes', async (request, reply) => {
    if (!authenticate(request, reply)) return;
    const { title, resumeJson, setActive } = request.body || {};
    if (!resumeJson) {
      return reply.code(400).send({ error: 'resumeJson is required' });
    }

    try {
      const saved = saveUserResume(db, {
        userId: request.user.id,
        title: title || 'Master Resume',
        resumeJson,
        setActive: setActive !== false,
      });
      return reply.code(201).send({ resume: saved });
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // PUT /api/v1/resumes/:id/active
  app.put('/api/v1/resumes/:id/active', async (request, reply) => {
    if (!authenticate(request, reply)) return;
    const { id } = request.params;
    const success = setActiveResume(db, { userId: request.user.id, resumeId: id });
    if (!success) {
      return reply.code(404).send({ error: 'resume not found' });
    }
    return { ok: true };
  });

  // DELETE /api/v1/resumes/:id
  app.delete('/api/v1/resumes/:id', async (request, reply) => {
    if (!authenticate(request, reply)) return;
    const { id } = request.params;
    const success = deleteUserResume(db, { userId: request.user.id, resumeId: id });
    if (!success) {
      return reply.code(404).send({ error: 'resume not found' });
    }
    return { ok: true };
  });

  // --- JOB INGEST & QUERY ROUTES (MULTI-TENANT) ---

  // POST /api/v1/jobs/ingest
  app.post('/api/v1/jobs/ingest', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const body = request.body;
    const jobs = Array.isArray(body) ? body : body?.jobs;
    if (!Array.isArray(jobs)) {
      return reply
        .code(400)
        .send({ error: 'body must be a JSON array of jobs or { jobs: [...] }' });
    }
    if (jobs.length === 0) {
      return reply.code(400).send({ error: 'body must not be empty' });
    }
    if (jobs.length > 200) {
      return reply.code(400).send({ error: 'batch size exceeds maximum of 200 jobs' });
    }

    const rows = [];
    for (const raw of jobs) {
      let row;
      try {
        row = normalizeJob({ ...raw, fingerprint: fingerprintFor(raw) });
      } catch (err) {
        return reply.code(400).send({ error: `invalid job: ${err.message}` });
      }
      rows.push(row);
    }

    let ingested = 0;
    let deduped = 0;
    const ids = [];
    const userId = request.user.id;
    const now = Date.now();

    db.transaction(() => {
      for (const row of rows) {
        const { id, deduped: dup } = insertIfNew(db, row);
        ids.push(id);
        if (dup) deduped += 1;
        else ingested += 1;

        // Associate job with user in user_jobs
        if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
          const ujId = `uj_${userId}_${id}`;
          db.prepare(
            `INSERT INTO user_jobs (id, user_id, job_id, fit_score, fit_notes, status, tailored_resume_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, job_id) DO NOTHING`
          ).run(ujId, userId, id, null, null, 'new', null, now, now);
        }
      }
    })();

    return { ingested, deduped, ids };
  });

  // GET /api/v1/jobs - Query jobs for authenticated user
  app.get('/api/v1/jobs', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { status, source, min_score, search, limit = 100 } = request.query || {};
    const userId = request.user.id;

    let query;
    const params = [];

    if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
      query = `
        SELECT 
          j.id, j.title, j.company, j.location, j.url, j.source, j.posted_at, j.description, j.fingerprint, j.liveness,
          COALESCE(uj.fit_score, j.fit_score) as fit_score,
          COALESCE(uj.fit_notes, j.fit_notes) as fit_notes,
          COALESCE(uj.status, j.status) as status,
          COALESCE(uj.tailored_resume_id, j.tailored_resume_id) as tailored_resume_id,
          COALESCE(uj.created_at, j.created_at) as created_at,
          COALESCE(uj.updated_at, j.updated_at) as updated_at
        FROM user_jobs uj
        JOIN jobs j ON uj.job_id = j.id
        WHERE uj.user_id = ?
      `;
      params.push(userId);
    } else {
      query = 'SELECT * FROM jobs WHERE 1=1';
    }

    if (status) {
      query +=
        userId && userId !== 'legacy-admin' && userId !== 'dev-user'
          ? ' AND uj.status = ?'
          : ' AND status = ?';
      params.push(status);
    }
    if (source) {
      query += ' AND j.source = ?';
      params.push(source);
    }
    if (min_score !== undefined && min_score !== '') {
      query +=
        userId && userId !== 'legacy-admin' && userId !== 'dev-user'
          ? ' AND uj.fit_score >= ?'
          : ' AND fit_score >= ?';
      params.push(Number(min_score));
    }
    if (search) {
      query += ' AND (j.title LIKE ? OR j.company LIKE ? OR j.description LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Number(limit));

    const jobs = db.prepare(query).all(...params);
    return { jobs };
  });

  // GET /api/v1/jobs/:id - Get a single job by id
  app.get('/api/v1/jobs/:id', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params;
    const userId = request.user.id;

    let job;
    if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
      job = db
        .prepare(
          `SELECT 
            j.id, j.title, j.company, j.location, j.url, j.source, j.posted_at, j.description, j.fingerprint, j.liveness,
            COALESCE(uj.fit_score, j.fit_score) as fit_score,
            COALESCE(uj.fit_notes, j.fit_notes) as fit_notes,
            COALESCE(uj.status, j.status) as status,
            COALESCE(uj.tailored_resume_id, j.tailored_resume_id) as tailored_resume_id,
            COALESCE(uj.created_at, j.created_at) as created_at,
            COALESCE(uj.updated_at, j.updated_at) as updated_at
          FROM user_jobs uj
          JOIN jobs j ON uj.job_id = j.id
          WHERE uj.user_id = ? AND j.id = ?`
        )
        .get(userId, id);
    } else {
      job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    }

    if (!job) {
      return reply.code(404).send({ error: 'job not found' });
    }
    return { job };
  });

  // PATCH /api/v1/jobs/:id - Update job status
  app.patch('/api/v1/jobs/:id', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params;
    const { status } = request.body || {};
    if (!status) {
      return reply.code(400).send({ error: 'status is required' });
    }

    const now = Date.now();
    const userId = request.user.id;

    if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
      const info = db
        .prepare('UPDATE user_jobs SET status = ?, updated_at = ? WHERE job_id = ? AND user_id = ?')
        .run(status, now, id, userId);

      if (info.changes === 0) {
        return reply.code(404).send({ error: 'job not found' });
      }
    } else {
      const info = db
        .prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, now, id);

      if (info.changes === 0) {
        return reply.code(404).send({ error: 'job not found' });
      }
    }

    let job;
    if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
      job = db
        .prepare(
          `SELECT 
            j.id, j.title, j.company, j.location, j.url, j.source, j.posted_at, j.description, j.fingerprint, j.liveness,
            COALESCE(uj.fit_score, j.fit_score) as fit_score,
            COALESCE(uj.fit_notes, j.fit_notes) as fit_notes,
            COALESCE(uj.status, j.status) as status,
            COALESCE(uj.tailored_resume_id, j.tailored_resume_id) as tailored_resume_id,
            COALESCE(uj.created_at, j.created_at) as created_at,
            COALESCE(uj.updated_at, j.updated_at) as updated_at
          FROM user_jobs uj
          JOIN jobs j ON uj.job_id = j.id
          WHERE uj.user_id = ? AND j.id = ?`
        )
        .get(userId, id);
    } else {
      job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    }

    return { job, ok: true, status };
  });

  // POST /api/v1/jobs/:id/tailor - Trigger manual tailor execution
  app.post('/api/v1/jobs/:id/tailor', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params;
    const userId = request.user.id;
    const now = Date.now();
    const tailoredId = `tailored-${id}-${Date.now().toString(36)}`;

    // 1. Validate Job
    const jobRecord = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!jobRecord) {
      return reply.code(404).send({ error: 'Job not found' });
    }
    if (!jobRecord.description || jobRecord.description.trim().length < 10) {
      return reply.code(400).send({
        error: 'Job description is missing or too short. Cannot tailor resume without job requirements.',
      });
    }

    // 2. Validate Master Resume
    let activeResume = null;
    if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
      const row = db
        .prepare(
          'SELECT resume_json FROM user_resumes WHERE user_id = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1'
        )
        .get(userId);
      if (row?.resume_json) {
        try {
          activeResume = JSON.parse(row.resume_json);
        } catch {}
      }
    }
    if (!activeResume) {
      const row = db.prepare('SELECT resume_json FROM user_resumes ORDER BY updated_at DESC LIMIT 1').get();
      if (row?.resume_json) {
        try {
          activeResume = JSON.parse(row.resume_json);
        } catch {}
      }
    }
    if (!activeResume) {
      return reply.code(400).send({
        error: 'No active master resume found. Please upload one in Profile & Resume before tailoring.',
      });
    }

    // 3. Perform Tailoring & Artifact Persistence
    const jobDir = resolve(artifactsDir, userId || 'dev-user', id);
    mkdirSync(jobDir, { recursive: true });

    // Tailor resume content (align title / summary / skills if relevant)
    const tailoredResume = JSON.parse(JSON.stringify(activeResume));
    if (tailoredResume.basics && jobRecord.title) {
      tailoredResume.basics.label = jobRecord.title;
    }

    // Write resume.json
    writeFileSync(resolve(jobDir, 'resume.json'), JSON.stringify(tailoredResume, null, 2), 'utf-8');

    // Synthesize ATS plain text
    const plainTextLines = [
      `${tailoredResume.basics?.name || 'Applicant'} — ${tailoredResume.basics?.label || jobRecord.title}`,
      `Email: ${tailoredResume.basics?.email || ''} | Location: ${tailoredResume.basics?.location?.city || ''}`,
      '',
      'SUMMARY',
      tailoredResume.basics?.summary || `Targeting ${jobRecord.title} at ${jobRecord.company}.`,
      '',
      'EXPERIENCE',
      ...(Array.isArray(tailoredResume.work)
        ? tailoredResume.work.map(
            (w) =>
              `${w.position || ''} at ${w.name || w.company || ''} (${w.startDate || ''} - ${w.endDate || 'Present'})\n` +
              (Array.isArray(w.highlights) ? w.highlights.map((h) => `• ${h}`).join('\n') : '')
          )
        : []),
      '',
      'SKILLS',
      ...(Array.isArray(tailoredResume.skills)
        ? tailoredResume.skills.map(
            (s) => `${s.name || ''}: ${(s.keywords || []).join(', ')}`
          )
        : []),
    ];
    const plainText = plainTextLines.join('\n');
    writeFileSync(resolve(jobDir, 'resume.txt'), plainText, 'utf-8');
    writeFileSync(resolve(jobDir, 'resume-text.txt'), plainText, 'utf-8');

    // Attempt external resume-ops call for PDF rendering if available
    const resumeOpsUrl = process.env.RESUME_OPS_URL;
    if (resumeOpsUrl) {
      try {
        const resp = await fetch(`${resumeOpsUrl.replace(/\/$/, '')}/api/v1/tailor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_description: jobRecord.description,
            resume: tailoredResume,
            theme: 'jsonresume-theme-folio',
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.pdf_base64) {
            writeFileSync(resolve(jobDir, 'resume.pdf'), Buffer.from(data.pdf_base64, 'base64'));
          }
          if (data.plain_text) {
            writeFileSync(resolve(jobDir, 'resume.txt'), data.plain_text, 'utf-8');
          }
        }
      } catch (err) {
        // Log and continue with synthesized text/json
        request.log?.warn?.(`resume-ops tailor call error: ${err.message}`);
      }
    }

    // 4. Update Database
    if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
      db.prepare(
        'UPDATE user_jobs SET status = ?, tailored_resume_id = ?, updated_at = ? WHERE job_id = ? AND user_id = ?'
      ).run('tailored', tailoredId, now, id, userId);
    } else {
      db.prepare(
        'UPDATE jobs SET status = ?, tailored_resume_id = ?, updated_at = ? WHERE id = ?'
      ).run('tailored', tailoredId, now, id);
    }

    let job;
    if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
      job = db
        .prepare(
          `SELECT 
            j.id, j.title, j.company, j.location, j.url, j.source, j.posted_at, j.description, j.fingerprint, j.liveness,
            COALESCE(uj.fit_score, j.fit_score) as fit_score,
            COALESCE(uj.fit_notes, j.fit_notes) as fit_notes,
            COALESCE(uj.status, j.status) as status,
            COALESCE(uj.tailored_resume_id, j.tailored_resume_id) as tailored_resume_id,
            COALESCE(uj.created_at, j.created_at) as created_at,
            COALESCE(uj.updated_at, j.updated_at) as updated_at
          FROM user_jobs uj
          JOIN jobs j ON uj.job_id = j.id
          WHERE uj.user_id = ? AND j.id = ?`
        )
        .get(userId, id);
    } else {
      job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    }

    return { ok: true, job, tailored_resume_id: tailoredId };
  });

  // GET /api/v1/jobs/:id/artifacts/:filename - Serve artifact file
  app.get('/api/v1/jobs/:id/artifacts/:filename', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id, filename } = request.params;
    const userId = request.user.id;
    const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '');

    // Check user-partitioned artifact path first, then flat fallback
    let filePath = resolve(artifactsDir, userId, id, safeFilename);
    if (!existsSync(filePath)) {
      filePath = resolve(artifactsDir, id, safeFilename);
    }

    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: 'artifact not found' });
    }

    const content = readFileSync(filePath);
    if (safeFilename.endsWith('.pdf')) {
      reply.type('application/pdf');
    } else if (safeFilename.endsWith('.json')) {
      reply.type('application/json');
    } else if (safeFilename.endsWith('.txt')) {
      reply.type('text/plain; charset=utf-8');
    }
    return reply.send(content);
  });

  // GET /api/v1/pipeline/stats - Aggregate stats for the pipeline view
  app.get('/api/v1/pipeline/stats', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const total = db.prepare('SELECT COUNT(*) as n FROM jobs').get().n;
    const unscored = db.prepare('SELECT COUNT(*) as n FROM jobs WHERE fit_score IS NULL').get().n;
    const scored = db.prepare('SELECT COUNT(*) as n FROM jobs WHERE fit_score IS NOT NULL').get().n;
    const tailored = db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status = 'tailored'").get().n;
    const failed = db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status IN ('failed', 'error', 'tailor_failed')").get().n;

    return {
      ok: true,
      stats: {
        total,
        unscored,
        scored,
        tailored,
        failed,
      },
    };
  });

  // GET /api/v1/pipeline/jobs - Live job queue for pipeline inspection
  app.get('/api/v1/pipeline/jobs', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const rows = db
      .prepare(
        `SELECT id, title, company, source, location, status, fit_score,
                description IS NOT NULL AND LENGTH(description) > 10 as has_description,
                created_at, updated_at
         FROM jobs ORDER BY updated_at DESC LIMIT 100`
      )
      .all();

    return { ok: true, jobs: rows };
  });

  return app;
}
