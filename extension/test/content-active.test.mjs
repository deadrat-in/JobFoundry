import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { findNextPageButton, runActiveCrawl } from '../src/content/active.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/content');

test('findNextPageButton detects pagination buttons across platforms', () => {
  const dom = new JSDOM(
    '<html><body><button aria-label="Next" class="artdeco-pagination__button--next">Next</button></body></html>'
  );
  const btn = findNextPageButton(dom.window.document);
  assert.ok(btn);
  assert.equal(btn.getAttribute('aria-label'), 'Next');
});

test('runActiveCrawl extracts jobs and respects maxPages limit', async () => {
  const html = readFileSync(resolve(FIXTURES, 'linkedin-search.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://www.linkedin.com/jobs/search' });

  const result = await runActiveCrawl({
    doc: dom.window.document,
    maxPages: 2,
    minDelayMs: 1,
    maxDelayMs: 2,
  });

  assert.equal(result.pagesVisited, 1); // Only 1 page because no next button in fixture
  assert.equal(result.totalJobsFound, 2);
  assert.equal(result.jobs[0].title, 'Frontend Architect');
});
