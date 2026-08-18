import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJob } from '../src/jobs/normalize.mjs';

const RAW = {
  title: 'Senior Backend Engineer',
  company: 'Acme Corp',
  location: 'Berlin, DE',
  url: 'https://acme.example/jobs/42',
  source: 'greenhouse',
  postedAt: '2026-08-01T12:00:00Z',
  description: 'A long enough description.',
  fingerprint: 'a1b2c3d4e5f6a7b8',
  extraUnknownField: 'must be dropped',
};

test('maps an extension payload to the canonical row shape', () => {
  const row = normalizeJob(RAW);
  assert.equal(row.title, RAW.title);
  assert.equal(row.company, RAW.company);
  assert.equal(row.location, RAW.location);
  assert.equal(row.url, RAW.url);
  assert.equal(row.source, RAW.source);
  assert.equal(row.posted_at, Date.parse(RAW.postedAt));
  assert.equal(row.description, RAW.description);
  assert.equal(row.fingerprint, RAW.fingerprint);
});

test('defaults for missing optional fields', () => {
  const row = normalizeJob({
    title: 'T',
    company: 'C',
    url: 'https://x.test/1',
    postedAt: 1720000000000,
  });
  assert.equal(row.source, 'unknown');
  assert.equal(row.liveness, 'unknown');
  assert.equal(row.status, 'new');
  assert.equal(row.fingerprint, '');
  assert.equal(row.posted_at, 1720000000000);
  assert.equal(row.location, null);
  assert.equal(row.fit_score, null);
  assert.equal(row.fit_notes, null);
  assert.equal(row.tailored_resume_id, null);
});

test('posted_at is epoch ms whether given as number or ISO string', () => {
  assert.equal(normalizeJob({ ...RAW, postedAt: 1722500000000 }).posted_at, 1722500000000);
  assert.equal(
    normalizeJob({ ...RAW, postedAt: '2026-08-01T12:00:00Z' }).posted_at,
    Date.parse('2026-08-01T12:00:00Z')
  );
  assert.equal(normalizeJob({ ...RAW, postedAt: undefined }).posted_at, null);
});

test('unknown fields are dropped', () => {
  const row = normalizeJob(RAW);
  assert.ok(!('extraUnknownField' in row));
  assert.ok(!('postedAt' in row));
});

test('id is derived from the fingerprint', () => {
  const a = normalizeJob(RAW);
  const b = normalizeJob({ ...RAW, company: 'Hays', title: 'Engineer' });
  assert.equal(a.id, b.id);
  assert.equal(a.id.length, 40);
});

test('id falls back to the URL when fingerprint is empty', () => {
  const a = normalizeJob({ ...RAW, fingerprint: '' });
  const b = normalizeJob({ ...RAW, fingerprint: '' });
  assert.equal(a.id, b.id);
  const c = normalizeJob({ ...RAW, fingerprint: '', url: 'https://other.test/9' });
  assert.notEqual(a.id, c.id);
});

test('different fingerprints produce different ids', () => {
  const a = normalizeJob(RAW);
  const b = normalizeJob({ ...RAW, fingerprint: 'ffffffffffffffff' });
  assert.notEqual(a.id, b.id);
});

test('invalid URLs throw a clear error', () => {
  assert.throws(() => normalizeJob({ ...RAW, url: 'not a url' }), /invalid url/i);
  assert.throws(() => normalizeJob({ ...RAW, url: '' }), /invalid url/i);
  assert.throws(() => normalizeJob({ ...RAW, url: undefined }), /invalid url/i);
  assert.throws(() => normalizeJob(null), /job must be an object/i);
});
