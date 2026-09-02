import Fastify from 'fastify';
import { Agent, setGlobalDispatcher } from 'undici';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  statSync,
  createReadStream,
} from 'node:fs';
import { resolve, extname } from 'node:path';

// Configure global undici dispatcher with 10-minute timeout for multi-stage LLM calls
try {
  setGlobalDispatcher(
    new Agent({
      headersTimeout: 600_000,
      bodyTimeout: 600_000,
      connectTimeout: 60_000,
    })
  );
} catch {}

import { randomUUID } from 'node:crypto';
import { normalizeJob } from './jobs/normalize.mjs';
import { fingerprintFor, insertIfNew } from './jobs/dedup.mjs';
import { parseJobDescription } from './jobs/parse-jd.mjs';
import { fetchAndDecantUrl, cleanBoilerplate } from './jobs/decant.mjs';
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
  staticDir = null,
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

  // POST /api/v1/jobs/parse-jd - Client-side JD parser (zero server web fetching)
  app.post('/api/v1/jobs/parse-jd', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const body = request.body || {};
    const text =
      typeof body.text === 'string'
        ? body.text
        : typeof body.rawText === 'string'
          ? body.rawText
          : '';
    const markdown =
      typeof body.markdown === 'string'
        ? body.markdown
        : typeof body.rawMarkdown === 'string'
          ? body.rawMarkdown
          : '';
    const url = typeof body.url === 'string' ? body.url : '';

    const content = markdown || text;
    if (!content || content.trim().length < 15) {
      return reply.code(400).send({
        error:
          'Job content is too short or missing. Please provide at least a few lines of job description text or markdown.',
      });
    }

    try {
      const parsed = await parseJobDescription({ text, markdown, url });
      return { ok: true, job: parsed };
    } catch (err) {
      request.log.error(err, 'Failed to parse job description');
      return reply.code(500).send({ error: `Failed to parse job description: ${err.message}` });
    }
  });

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

      // Universal Decanter safety net: fetch and populate if description is missing or truncated
      const descTrimmed = (row.description || '').trim();
      const isTruncated =
        !descTrimmed ||
        descTrimmed.length < 250 ||
        /(\.\.\.|…)\s*(see more|read more|view more)?\s*$/i.test(descTrimmed) ||
        /\b(see more|read more)\s*$/i.test(descTrimmed);

      if (isTruncated && row.url && /^https?:\/\//i.test(row.url)) {
        try {
          const decanted = await fetchAndDecantUrl(row.url, { timeoutMs: 5000 });
          if (decanted && decanted.length > descTrimmed.length) {
            row.description = decanted;
          }
        } catch {}
      }

      if (row.description) {
        row.description = cleanBoilerplate(row.description);
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

    const { status, source, min_score, search, sort_by = 'created_at', order = 'desc', limit = 100 } =
      request.query || {};
    const userId = request.user.id;
    const isMultiTenant = Boolean(userId && userId !== 'legacy-admin' && userId !== 'dev-user');
    const sortDirection = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    let query;
    const params = [];

    if (isMultiTenant) {
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
      query += isMultiTenant ? ' AND uj.status = ?' : ' AND status = ?';
      params.push(status);
    }
    if (source) {
      query += isMultiTenant ? ' AND j.source = ?' : ' AND source = ?';
      params.push(source);
    }
    if (min_score !== undefined && min_score !== '') {
      query += isMultiTenant ? ' AND uj.fit_score >= ?' : ' AND fit_score >= ?';
      params.push(Number(min_score));
    }
    if (search) {
      query += isMultiTenant
        ? ' AND (j.title LIKE ? OR j.company LIKE ? OR j.description LIKE ?)'
        : ' AND (title LIKE ? OR company LIKE ? OR description LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    let orderClause = isMultiTenant ? 'ORDER BY uj.created_at DESC' : 'ORDER BY created_at DESC';
    if (sort_by === 'fit_score') {
      orderClause = isMultiTenant
        ? `ORDER BY (uj.fit_score IS NULL), uj.fit_score ${sortDirection}, uj.created_at DESC`
        : `ORDER BY (fit_score IS NULL), fit_score ${sortDirection}, created_at DESC`;
    } else if (sort_by === 'created_at') {
      orderClause = `ORDER BY ${isMultiTenant ? 'uj.created_at' : 'created_at'} ${sortDirection}`;
    } else if (sort_by === 'updated_at') {
      orderClause = `ORDER BY ${isMultiTenant ? 'uj.updated_at' : 'updated_at'} ${sortDirection}`;
    } else if (sort_by === 'title') {
      orderClause = `ORDER BY ${isMultiTenant ? 'j.title' : 'title'} COLLATE NOCASE ${sortDirection}`;
    } else if (sort_by === 'company') {
      orderClause = `ORDER BY ${isMultiTenant ? 'j.company' : 'company'} COLLATE NOCASE ${sortDirection}`;
    } else if (sort_by === 'status') {
      orderClause = `ORDER BY ${isMultiTenant ? 'uj.status' : 'status'} ${sortDirection}`;
    }

    query += ` ${orderClause} LIMIT ?`;
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

  // POST /api/v1/jobs/:id/decant - Auto-fetch and decant job description from its URL
  app.post('/api/v1/jobs/:id/decant', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params;
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!job) {
      return reply.code(404).send({ error: 'job not found' });
    }

    if (!job.url || !/^https?:\/\//i.test(job.url)) {
      return reply.code(400).send({ error: 'job has no valid URL to fetch' });
    }

    const decanted = await fetchAndDecantUrl(job.url, { timeoutMs: 8000 });
    if (!decanted || decanted.length < 50) {
      return reply.code(422).send({ error: 'Could not extract job description from URL' });
    }

    const now = Date.now();
    const userId = request.user.id;

    db.prepare('UPDATE jobs SET description = ?, updated_at = ? WHERE id = ?').run(
      decanted,
      now,
      id
    );

    if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
      db.prepare(
        "UPDATE user_jobs SET fit_score = NULL, fit_notes = NULL, status = 'new', updated_at = ? WHERE job_id = ? AND user_id = ?"
      ).run(now, id, userId);
    }

    const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return { ok: true, job: updatedJob, description: decanted };
  });

  // POST /api/v1/jobs/:id/sanitize - Fetch full page from URL if needed & clean with LLM
  app.post('/api/v1/jobs/:id/sanitize', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params;
    const { refetch = false } = request.body || {};
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!job) {
      return reply.code(404).send({ error: 'job not found' });
    }

    let rawContent = (job.description || '').trim();

    // If description is missing/short/truncated or refetch requested, fetch live URL first
    const isTruncated =
      !rawContent ||
      rawContent.length < 300 ||
      /(\.\.\.|…)\s*(see more|read more|view more)?\s*$/i.test(rawContent) ||
      /\b(see more|read more)\s*$/i.test(rawContent);

    if ((refetch || isTruncated) && job.url && /^https?:\/\//i.test(job.url)) {
      try {
        const decanted = await fetchAndDecantUrl(job.url, { timeoutMs: 8000 });
        if (decanted && decanted.length > 50) {
          rawContent = decanted;
        }
      } catch {}
    }

    if (!rawContent || rawContent.length < 15) {
      return reply.code(422).send({
        error: 'Unable to retrieve sufficient job description content from database or live URL',
      });
    }

    try {
      const parsed = await parseJobDescription({
        text: rawContent,
        url: job.url,
      });

      const now = Date.now();
      const userId = request.user.id;

      const title =
        parsed.title && parsed.title !== 'Job Opportunity' && !/^\d+\s+notifications?$/i.test(parsed.title)
          ? parsed.title
          : job.title;
      const company =
        parsed.company && parsed.company !== 'Company' ? parsed.company : job.company;
      const location = parsed.location || job.location;
      const description = parsed.description || rawContent;

      db.prepare(
        'UPDATE jobs SET title = ?, company = ?, location = ?, description = ?, updated_at = ? WHERE id = ?'
      ).run(title, company, location, description, now, id);

      if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
        db.prepare(
          "UPDATE user_jobs SET fit_score = NULL, fit_notes = NULL, status = 'new', updated_at = ? WHERE job_id = ? AND user_id = ?"
        ).run(now, id, userId);
      }

      const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
      return { ok: true, job: updatedJob, parsed };
    } catch (err) {
      return reply.code(500).send({ error: `Sanitization failed: ${err.message}` });
    }
  });

  // PATCH /api/v1/jobs/:id - Update job status or description
  app.patch('/api/v1/jobs/:id', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params;
    const { status, description } = request.body || {};
    if (!status && description === undefined) {
      return reply.code(400).send({ error: 'status or description is required' });
    }

    const now = Date.now();
    const userId = request.user.id;

    if (description !== undefined) {
      db.prepare('UPDATE jobs SET description = ?, updated_at = ? WHERE id = ?').run(
        description,
        now,
        id
      );
      if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
        db.prepare(
          "UPDATE user_jobs SET fit_score = NULL, fit_notes = NULL, status = 'new', updated_at = ? WHERE job_id = ? AND user_id = ?"
        ).run(now, id, userId);
      }
    }

    if (status) {
      if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
        const info = db
          .prepare(
            'UPDATE user_jobs SET status = ?, updated_at = ? WHERE job_id = ? AND user_id = ?'
          )
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

  // DELETE /api/v1/jobs/:id - Delete a job from DB and its artifacts
  app.delete('/api/v1/jobs/:id', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params;
    const userId = request.user.id;

    if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
      db.prepare('DELETE FROM user_jobs WHERE job_id = ? AND user_id = ?').run(id, userId);
    }
    // Also remove from master jobs table
    const info = db.prepare('DELETE FROM jobs WHERE id = ?').run(id);

    return { ok: true, id, changes: info.changes };
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
        error:
          'Job description is missing or too short. Cannot tailor resume without job requirements.',
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
      const row = db
        .prepare('SELECT resume_json FROM user_resumes ORDER BY updated_at DESC LIMIT 1')
        .get();
      if (row?.resume_json) {
        try {
          activeResume = JSON.parse(row.resume_json);
        } catch {}
      }
    }
    if (!activeResume) {
      return reply.code(400).send({
        error:
          'No active master resume found. Please upload one in Profile & Resume before tailoring.',
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
        ? tailoredResume.skills.map((s) => `${s.name || ''}: ${(s.keywords || []).join(', ')}`)
        : []),
    ];
    const plainText = plainTextLines.join('\n');
    writeFileSync(resolve(jobDir, 'resume.txt'), plainText, 'utf-8');
    writeFileSync(resolve(jobDir, 'resume-text.txt'), plainText, 'utf-8');

    // Attempt external resume-ops call for tailoring and PDF rendering
    const resumeOpsUrl = process.env.RESUME_OPS_URL || 'http://127.0.0.1:8081';
    let tailorSuccess = false;
    let tailorError = null;

    if (resumeOpsUrl) {
      try {
        const resp = await fetch(`${resumeOpsUrl.replace(/\/$/, '')}/api/v1/tailor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(600000), // 10 minute timeout
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
            writeFileSync(resolve(jobDir, 'resume-text.txt'), data.plain_text, 'utf-8');
          }
          if (data.resume) {
            writeFileSync(resolve(jobDir, 'resume.json'), JSON.stringify(data.resume, null, 2), 'utf-8');
          }
          tailorSuccess = true;
        } else {
          const errBody = await resp.text().catch(() => '');
          tailorError = `resume-ops returned ${resp.status}: ${errBody}`;
          request.log?.error?.(tailorError);
        }
      } catch (err) {
        tailorError = `resume-ops tailor call error: ${err.message}`;
        request.log?.error?.(tailorError);
      }
    }

    if (!tailorSuccess) {
      // Clean up incomplete artifacts if any
      const statusToSet = 'failed';
      if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
        db.prepare(
          'UPDATE user_jobs SET status = ?, updated_at = ? WHERE job_id = ? AND user_id = ?'
        ).run(statusToSet, now, id, userId);
      } else {
        db.prepare(
          'UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?'
        ).run(statusToSet, now, id);
      }
      return reply.code(502).send({
        error: tailorError || 'Failed to tailor resume via AI service',
        status: 'failed',
      });
    }

    // 4. Update Database on success
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
    const userId = request.user?.id;

    if (userId && userId !== 'legacy-admin' && userId !== 'dev-user') {
      const total = db
        .prepare('SELECT COUNT(*) as n FROM user_jobs WHERE user_id = ?')
        .get(userId).n;
      const unscored = db
        .prepare('SELECT COUNT(*) as n FROM user_jobs WHERE user_id = ? AND fit_score IS NULL')
        .get(userId).n;
      const scored = db
        .prepare('SELECT COUNT(*) as n FROM user_jobs WHERE user_id = ? AND fit_score IS NOT NULL')
        .get(userId).n;
      const tailored = db
        .prepare("SELECT COUNT(*) as n FROM user_jobs WHERE user_id = ? AND status = 'tailored'")
        .get(userId).n;
      const failed = db
        .prepare(
          "SELECT COUNT(*) as n FROM user_jobs WHERE user_id = ? AND status IN ('score_failed', 'tailor_failed', 'failed', 'error')"
        )
        .get(userId).n;

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
    }

    const total = db.prepare('SELECT COUNT(*) as n FROM jobs').get().n;
    const unscored = db.prepare('SELECT COUNT(*) as n FROM jobs WHERE fit_score IS NULL').get().n;
    const scored = db.prepare('SELECT COUNT(*) as n FROM jobs WHERE fit_score IS NOT NULL').get().n;
    const tailored = db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status = 'tailored'").get().n;
    const failed = db
      .prepare(
        "SELECT COUNT(*) as n FROM jobs WHERE status IN ('failed', 'error', 'tailor_failed')"
      )
      .get().n;

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
    const userId = request.user?.id;
    const { sort_by = 'updated_at', order = 'desc', limit = 100 } = request.query || {};

    const isMultiTenant = Boolean(userId && userId !== 'legacy-admin' && userId !== 'dev-user');
    const sortDirection = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    let orderClause = isMultiTenant
      ? `ORDER BY uj.updated_at ${sortDirection}`
      : `ORDER BY updated_at ${sortDirection}`;
    if (sort_by === 'fit_score') {
      orderClause = isMultiTenant
        ? `ORDER BY (uj.fit_score IS NULL), uj.fit_score ${sortDirection}`
        : `ORDER BY (fit_score IS NULL), fit_score ${sortDirection}`;
    } else if (sort_by === 'title') {
      orderClause = isMultiTenant
        ? `ORDER BY j.title COLLATE NOCASE ${sortDirection}`
        : `ORDER BY title COLLATE NOCASE ${sortDirection}`;
    } else if (sort_by === 'company') {
      orderClause = isMultiTenant
        ? `ORDER BY j.company COLLATE NOCASE ${sortDirection}`
        : `ORDER BY company COLLATE NOCASE ${sortDirection}`;
    } else if (sort_by === 'source') {
      orderClause = isMultiTenant
        ? `ORDER BY j.source COLLATE NOCASE ${sortDirection}`
        : `ORDER BY source COLLATE NOCASE ${sortDirection}`;
    } else if (sort_by === 'status') {
      orderClause = isMultiTenant ? `ORDER BY uj.status ${sortDirection}` : `ORDER BY status ${sortDirection}`;
    } else if (sort_by === 'has_description') {
      orderClause = `ORDER BY has_description ${sortDirection}`;
    } else if (sort_by === 'created_at') {
      orderClause = isMultiTenant ? `ORDER BY uj.created_at ${sortDirection}` : `ORDER BY created_at ${sortDirection}`;
    }

    let rows;
    if (isMultiTenant) {
      rows = db
        .prepare(
          `SELECT uj.id, j.id as job_id, j.title, j.company, j.source, j.location, uj.status, uj.fit_score,
                  j.description IS NOT NULL AND LENGTH(j.description) > 10 as has_description,
                  uj.created_at, uj.updated_at
           FROM user_jobs uj
           JOIN jobs j ON uj.job_id = j.id
           WHERE uj.user_id = ?
           ${orderClause} LIMIT ?`
        )
        .all(userId, Number(limit));
    } else {
      rows = db
        .prepare(
          `SELECT id, id as job_id, title, company, source, location, status, fit_score,
                  description IS NOT NULL AND LENGTH(description) > 10 as has_description,
                  created_at, updated_at
           FROM jobs ${orderClause} LIMIT ?`
        )
        .all(Number(limit));
    }

    return { ok: true, jobs: rows };
  });

  if (staticDir && existsSync(staticDir)) {
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.ttf': 'font/ttf',
    };

    const resolvedStatic = resolve(staticDir);

    app.setNotFoundHandler(async (request, reply) => {
      // If it's an API request or healthcheck, return 404 JSON
      if (request.url.startsWith('/api/') || request.url.startsWith('/health')) {
        return reply.status(404).send({ error: 'not_found', message: 'Route not found' });
      }

      const cleanUrl = request.url.split('?')[0];
      const targetPath = resolve(resolvedStatic, cleanUrl === '/' ? 'index.html' : '.' + cleanUrl);

      // Security check: ensure targetPath is within resolvedStatic
      if (targetPath.startsWith(resolvedStatic)) {
        if (existsSync(targetPath) && statSync(targetPath).isFile()) {
          const ext = extname(targetPath).toLowerCase();
          const contentType = mimeTypes[ext] || 'application/octet-stream';
          reply.header('Content-Type', contentType);
          return reply.send(createReadStream(targetPath));
        }
      }

      // SPA fallback: return index.html for client-side routing
      const indexPath = resolve(resolvedStatic, 'index.html');
      if (existsSync(indexPath)) {
        reply.header('Content-Type', 'text/html; charset=utf-8');
        return reply.send(createReadStream(indexPath));
      }

      return reply.status(404).send({ error: 'not_found', message: 'Page not found' });
    });
  }

  return app;
}
