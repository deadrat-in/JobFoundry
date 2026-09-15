import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRepost, normalizeJobTitle, normalizeCompany } from '../src/jobs/detect-reposts.mjs';

test('detect-reposts: normalizes titles and companies cleanly', () => {
  assert.equal(normalizeJobTitle('Senior Staff Software Engineer (Remote)'), 'software engineer');
  assert.equal(normalizeCompany('Acme Corporation, Inc.'), 'acme');
});

test('detect-reposts: tokenizes punctuation-separated stop words before filtering', () => {
  assert.equal(
    normalizeJobTitle('Sr./Lead Full-Time Platform Engineer — Hybrid'),
    'platform engineer'
  );
  assert.equal(normalizeCompany('Acme.Co / GmbH, LLC'), 'acme');
});

test('detect-reposts: preserves stop-word substrings inside meaningful words', () => {
  assert.equal(
    normalizeJobTitle('Stafford Principalities Engineer'),
    'stafford principalities engineer'
  );
  assert.equal(normalizeCompany('Coincidental Corporation Systems'), 'coincidental systems');
});

test('detect-reposts: handles empty, non-string, and stop-word-only inputs', () => {
  assert.equal(normalizeJobTitle('Senior / Remote / Full-Time'), '');
  assert.equal(normalizeCompany('Inc., LLC & Co.'), '');
  assert.equal(normalizeJobTitle(null), '');
  assert.equal(normalizeCompany({ name: 'Acme' }), '');
});

test('detect-reposts: identifies evergreen posting recycled over 60 days', () => {
  const currentJob = {
    title: 'Senior Backend Engineer',
    company: 'Stark Industries Inc',
    url: 'https://stark.test/jobs/new-req',
    posted_at: Date.now(),
  };

  const history = [
    {
      title: 'Backend Engineer',
      company: 'Stark Industries',
      url: 'https://stark.test/jobs/old-req-1',
      posted_at: Date.now() - 60 * 24 * 60 * 60 * 1000,
    },
    {
      title: 'Staff Backend Engineer',
      company: 'Stark Industries LLC',
      url: 'https://stark.test/jobs/old-req-2',
      posted_at: Date.now() - 30 * 24 * 60 * 60 * 1000,
    },
  ];

  const result = analyzeRepost(currentJob, history);
  assert.equal(result.isRepost, true);
  assert.equal(result.count, 2);
  assert.equal(result.confidence, 'high');
  assert.ok(result.daysSpan >= 60);
});

test('detect-reposts: ignores unique role with no previous company matches', () => {
  const currentJob = {
    title: 'Lead Quantitative Researcher',
    company: 'Wayne Enterprises',
    url: 'https://wayne.test/jobs/quant',
    posted_at: Date.now(),
  };

  const result = analyzeRepost(currentJob, []);
  assert.equal(result.isRepost, false);
  assert.equal(result.confidence, 'none');
});

test('detect-reposts: does not match when normalization removes the entire title or company', () => {
  const result = analyzeRepost(
    { title: 'Senior / Remote', company: 'Inc., LLC', url: 'https://example.test/current' },
    [
      {
        title: 'Senior',
        company: 'LLC',
        url: 'https://example.test/previous',
        posted_at: Date.now() - 90 * 24 * 60 * 60 * 1000,
      },
    ]
  );

  assert.deepEqual(result, { isRepost: false, count: 0, daysSpan: 0, confidence: 'none' });
});
