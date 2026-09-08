import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRepost, normalizeJobTitle, normalizeCompany } from '../src/jobs/detect-reposts.mjs';

test('detect-reposts: normalizes titles and companies cleanly', () => {
  assert.equal(normalizeJobTitle('Senior Staff Software Engineer (Remote)'), 'software engineer');
  assert.equal(normalizeCompany('Acme Corporation, Inc.'), 'acme');
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
