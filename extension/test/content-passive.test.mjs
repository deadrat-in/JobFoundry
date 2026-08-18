import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createPassiveObserver } from '../src/content/passive.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/content');

test('passive observer extracts jobs on initial start and ignores duplicates', async () => {
  const html = readFileSync(resolve(FIXTURES, 'linkedin-search.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://www.linkedin.com/jobs/search' });
  const discovered = [];

  const observer = createPassiveObserver({
    doc: dom.window.document,
    win: dom.window,
    debounceMs: 10,
    onJobsFound: (jobs) => {
      discovered.push(...jobs);
    },
  });

  observer.start();
  assert.equal(discovered.length, 2);
  assert.equal(discovered[0].title, 'Frontend Architect');

  // Triggering scan again on unchanged DOM does not re-emit
  observer.scan();
  assert.equal(discovered.length, 2);

  observer.stop();
});

test('passive observer reacts to DOM changes', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><ul id="jobs"></ul></body></html>', {
    url: 'https://www.linkedin.com/jobs/search',
  });
  const discovered = [];

  const observer = createPassiveObserver({
    doc: dom.window.document,
    win: dom.window,
    debounceMs: 20,
    onJobsFound: (jobs) => {
      discovered.push(...jobs);
    },
  });

  observer.start();
  assert.equal(discovered.length, 0);

  // Dynamically insert a job card
  const ul = dom.window.document.getElementById('jobs');
  const li = dom.window.document.createElement('li');
  li.className = 'job-card-container';
  li.innerHTML = `
    <a class="job-card-list__title" href="https://www.linkedin.com/jobs/view/99999/">New Role</a>
    <div class="job-card-container__primary-description">NewCorp</div>
  `;
  ul.appendChild(li);

  // Wait for debounce & mutation observation
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].title, 'New Role');
  assert.equal(discovered[0].company, 'NewCorp');

  observer.stop();
});
