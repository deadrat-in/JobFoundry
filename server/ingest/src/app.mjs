import Fastify from 'fastify';
import { normalizeJob } from './jobs/normalize.mjs';
import { fingerprintFor, insertIfNew } from './jobs/dedup.mjs';

function bearerToken(header) {
  if (typeof header !== 'string') return '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export function buildApp({ db, apiKeys }) {
  const keys = new Set(apiKeys ?? []);
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ ok: true }));

  app.post('/api/v1/jobs/ingest', async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (!keys.has(token)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const body = request.body;
    if (!Array.isArray(body)) {
      return reply.code(400).send({ error: 'body must be a JSON array of jobs' });
    }
    if (body.length === 0) {
      return reply.code(400).send({ error: 'body must not be empty' });
    }

    const rows = [];
    for (const raw of body) {
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

  return app;
}
