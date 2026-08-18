import Fastify from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeJob } from './jobs/normalize.mjs';
import { fingerprintFor, insertIfNew } from './jobs/dedup.mjs';

function bearerToken(header) {
  if (typeof header !== 'string') return '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export function buildApp({ db, apiKeys, artifactsDir = './data/artifacts', serverUrl = '' }) {
  const keys = new Set(apiKeys ?? []);
  const app = Fastify({ logger: false });

  // Enable CORS
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (request.method === 'OPTIONS') {
      return reply.code(200).send();
    }
  });

  function authenticate(request, reply) {
    if (keys.size === 0) return true; // dev mode if no keys configured
    const token = bearerToken(request.headers.authorization);
    if (!keys.has(token)) {
      reply.code(401).send({ error: 'unauthorized' });
      return false;
    }
    return true;
  }

  app.get('/health', async () => ({ ok: true }));

  // GET /api/v1/extension/config - Seed config bundle for browser extension
  app.get('/api/v1/extension/config', async (request) => {
    const hostHeader = request.headers.host;
    const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
    const computedUrl =
      serverUrl || (hostHeader ? `${protocol}://${hostHeader}` : 'http://localhost:8080');
    return {
      serverUrl: computedUrl,
      apiKey: keys.size > 0 ? Array.from(keys)[0] : '',
      scanIntervalHours: 6,
      passiveMode: true,
      activeMode: false,
      fitThreshold: 75,
      portals: {},
    };
  });

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
    for (const row of rows) {
      const { id, deduped: dup } = insertIfNew(db, row);
      ids.push(id);
      if (dup) deduped += 1;
      else ingested += 1;
    }
    return { ingested, deduped, ids };
  });

  // GET /api/v1/jobs - Query jobs with optional filters
  app.get('/api/v1/jobs', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { status, source, min_score, search, limit = 100 } = request.query || {};
    let query = 'SELECT * FROM jobs WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (source) {
      query += ' AND source = ?';
      params.push(source);
    }
    if (min_score !== undefined && min_score !== '') {
      query += ' AND fit_score >= ?';
      params.push(Number(min_score));
    }
    if (search) {
      query += ' AND (title LIKE ? OR company LIKE ? OR description LIKE ?)';
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
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
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
    const info = db
      .prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id);

    if (info.changes === 0) {
      return reply.code(404).send({ error: 'job not found' });
    }

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return { job };
  });

  // POST /api/v1/jobs/:id/tailor - Trigger manual tailor override
  app.post('/api/v1/jobs/:id/tailor', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id } = request.params;
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!job) {
      return reply.code(404).send({ error: 'job not found' });
    }

    const now = Date.now();
    const tailoredId = `tailored-${id}-${Date.now().toString(36)}`;
    db.prepare(
      'UPDATE jobs SET status = ?, tailored_resume_id = ?, updated_at = ? WHERE id = ?'
    ).run('tailored', tailoredId, now, id);

    const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return { job: updatedJob, tailored_resume_id: tailoredId };
  });

  // GET /api/v1/jobs/:id/artifacts/:filename - Serve artifact file
  app.get('/api/v1/jobs/:id/artifacts/:filename', async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const { id, filename } = request.params;
    // Sanitize filename
    const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '');
    const filePath = resolve(artifactsDir, id, safeFilename);

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

  return app;
}
