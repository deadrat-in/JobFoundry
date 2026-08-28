import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.mjs';
import { normalizeJob } from '../src/jobs/normalize.mjs';
import { fingerprintFor, insertIfNew } from '../src/jobs/dedup.mjs';
import {
  fingerprintText,
  similarity,
  normalizeJdText,
  CROSSLIST_THRESHOLD,
} from '../src/jobs/dedup/fingerprint-core.mjs';

const JD_A =
  'Senior backend engineer working on distributed payment platforms. You will design and operate high throughput services, own reliability, and mentor other engineers across the payments organisation. Experience with Go, Kubernetes and event driven systems is expected for this role.';

const JD_B =
  'Frontend designer responsible for our design system and component library. You will collaborate closely with product managers and engineers to ship polished, accessible interfaces. A strong eye for typography, motion and spacing is essential for this role.';

test('same JD text produces the same fingerprint', () => {
  assert.equal(fingerprintText(JD_A), fingerprintText(JD_A));
  assert.equal(fingerprintFor({ description: JD_A }), fingerprintFor({ description: JD_A }));
  assert.match(fingerprintText(JD_A), /^[0-9a-f]{16}$/);
});

test('semantically identical postings by different agencies share a fingerprint', () => {
  const direct = fingerprintFor({
    title: 'Backend Engineer',
    company: 'Acme Corp',
    description: JD_A,
  });
  const agency = fingerprintFor({
    title: 'Platform Engineer (Contract)',
    company: 'Hays',
    description: JD_A,
  });
  assert.equal(direct, agency);
  assert.ok(direct.length > 0);
});

test('distinct JDs produce different fingerprints', () => {
  assert.notEqual(fingerprintText(JD_A), fingerprintText(JD_B));
});

test('short descriptions are not fingerprintable (no body, no signal)', () => {
  assert.equal(fingerprintText('Come join our team!'), '');
  assert.equal(fingerprintFor({ description: 'Apply now.' }), '');
});

test('fingerprinting is deterministic and URL/title/company independent', () => {
  assert.equal(fingerprintFor({ description: JD_A }), fingerprintFor({ description: JD_A }));
  assert.equal(
    fingerprintFor({ description: JD_A, title: 'X', company: 'Y' }),
    fingerprintFor({ description: JD_A })
  );
});

test('similarity mirrors the career-ops cross-listing threshold (≤5 bits match at 0.92)', () => {
  const f = fingerprintText(JD_A);
  assert.equal(similarity(f, f), 1);
  const near = atDistance(f, 5);
  const far = atDistance(f, 6);
  assert.ok(similarity(f, near) >= CROSSLIST_THRESHOLD);
  assert.ok(similarity(f, far) < CROSSLIST_THRESHOLD);
});

test('malformed fingerprints never match (similarity 0)', () => {
  assert.equal(similarity('', fingerprintText(JD_A)), 0);
  assert.equal(similarity(null, fingerprintText(JD_A)), 0);
  assert.equal(similarity('zzzz', fingerprintText(JD_A)), 0);
});

test('end-to-end: two ingests of the same job in one DB is a no-op returning the existing id', () => {
  const db = openDb({ path: ':memory:' });
  try {
    const first = normalizeJob({
      title: 'Backend Engineer',
      company: 'Acme Corp',
      url: 'https://acme.example/j/42',
      source: 'greenhouse',
      postedAt: '2026-08-01T12:00:00Z',
      description: JD_A,
      fingerprint: fingerprintFor({ description: JD_A }),
    });
    const { id: id1 } = insertIfNew(db, first);

    const second = normalizeJob({
      title: 'Backend Engineer',
      company: 'Acme Corp',
      url: 'https://acme.example/j/42',
      source: 'greenhouse',
      postedAt: '2026-08-01T12:00:00Z',
      description: JD_A,
      fingerprint: fingerprintFor({ description: JD_A }),
    });
    const { id: id2 } = insertIfNew(db, second);

    assert.equal(id2, id1);
    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM jobs WHERE url = ?')
      .get('https://acme.example/j/42');
    assert.equal(rows.n, 1);
  } finally {
    db.close();
  }
});

test('same fingerprint from a different agency URL is treated as one authoritative job', () => {
  const db = openDb({ path: ':memory:' });
  try {
    const direct = normalizeJob({
      title: 'Backend Engineer',
      company: 'Acme Corp',
      url: 'https://acme.example/j/42',
      source: 'greenhouse',
      description: JD_A,
      fingerprint: fingerprintFor({ description: JD_A }),
    });
    const { id: id1 } = insertIfNew(db, direct);

    const agency = normalizeJob({
      title: 'Platform Engineer',
      company: 'Hays',
      url: 'https://hays.example/listing/7',
      source: 'lever',
      description: JD_A,
      fingerprint: fingerprintFor({ description: JD_A }),
    });
    const { id: id2 } = insertIfNew(db, agency);

    assert.equal(id2, id1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n, 1);
  } finally {
    db.close();
  }
});

function atDistance(fp, n) {
  let v = BigInt('0x' + fp);
  const bits = new Set();
  while (bits.size < n) bits.add(Math.floor(Math.random() * 64));
  for (const b of bits) v ^= 1n << BigInt(b);
  return v.toString(16).padStart(16, '0');
}

test('normalizeJdText strips tags, entities and URLs', () => {
  assert.equal(
    normalizeJdText('<p>Hello &amp; welcome</p> https://acme.example/a/b\n\nHello world'),
    'hello welcome hello world'
  );
});

test('existing job with empty description is enriched when re-ingested with full description', () => {
  const db = openDb({ path: ':memory:' });
  try {
    const emptyJob = normalizeJob({
      title: 'Senior Engineer',
      company: 'Acme',
      url: 'https://acme.example/jobs/99',
      source: 'linkedin',
      description: '',
      fingerprint: '',
    });
    const { id: id1 } = insertIfNew(db, emptyJob);

    let saved = db.prepare('SELECT description FROM jobs WHERE id = ?').get(id1);
    assert.equal(saved.description, '');

    const fullJob = normalizeJob({
      title: 'Senior Engineer',
      company: 'Acme',
      url: 'https://acme.example/jobs/99',
      source: 'linkedin',
      description: JD_A,
      fingerprint: fingerprintFor({ description: JD_A }),
    });
    const { id: id2 } = insertIfNew(db, fullJob);
    assert.equal(id2, id1);

    saved = db.prepare('SELECT description, fingerprint FROM jobs WHERE id = ?').get(id1);
    assert.equal(saved.description, JD_A);
    assert.equal(saved.fingerprint, fingerprintFor({ description: JD_A }));
  } finally {
    db.close();
  }
});
