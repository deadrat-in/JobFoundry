import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import {
  extractLinkedIn,
  extractLinkedInJobDetails,
  extractLinkedInSearchCards,
} from '../src/content/extractors/linkedin.js';
import {
  extractIndeed,
  extractIndeedJobDetails,
  extractIndeedSearchCards,
} from '../src/content/extractors/indeed.js';
import {
  extractGlassdoor,
  extractGlassdoorJobDetails,
  extractGlassdoorSearchCards,
} from '../src/content/extractors/glassdoor.js';
import {
  extractNaukri,
  extractNaukriJobDetails,
  extractNaukriSearchCards,
} from '../src/content/extractors/naukri.js';
import { detectPlatform, extractJobsFromDocument } from '../src/content/extractors/index.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/content');

function loadFixtureDoc(filename, url) {
  const html = readFileSync(resolve(FIXTURES, filename), 'utf8');
  const dom = new JSDOM(html, { url });
  return dom.window.document;
}

test('detectPlatform identifies target platforms', () => {
  assert.equal(detectPlatform('https://www.linkedin.com/jobs/search'), 'linkedin');
  assert.equal(detectPlatform('https://uk.indeed.com/viewjob?jk=123'), 'indeed');
  assert.equal(detectPlatform('https://www.glassdoor.com/Job/index.htm'), 'glassdoor');
  assert.equal(detectPlatform('https://www.naukri.com/job-listings-dev'), 'naukri');
  assert.equal(detectPlatform('https://example.com/jobs'), null);
});

test('LinkedIn: extracts single job detail page', () => {
  const doc = loadFixtureDoc(
    'linkedin-detail.html',
    'https://www.linkedin.com/jobs/view/1234567890/'
  );
  const job = extractLinkedInJobDetails(doc);

  assert.ok(job);
  assert.equal(job.title, 'Staff Software Engineer');
  assert.equal(job.company, 'Acme Corp');
  assert.equal(job.location, 'San Francisco, CA (Hybrid)');
  assert.equal(job.salary, '$180,000/yr - $240,000/yr');
  assert.ok(job.description.includes('Node.js and TypeScript'));
  assert.equal(job.url, 'https://www.linkedin.com/jobs/view/1234567890/');
  assert.equal(job.source, 'linkedin');
});

test('LinkedIn: extracts search results list cards', () => {
  const doc = loadFixtureDoc(
    'linkedin-search.html',
    'https://www.linkedin.com/jobs/search?keywords=architect'
  );
  const jobs = extractLinkedInSearchCards(doc);

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, 'Frontend Architect');
  assert.equal(jobs[0].company, 'DesignCo');
  assert.equal(jobs[0].location, 'Remote, US');
  assert.equal(jobs[0].url, 'https://www.linkedin.com/jobs/view/20001/?tracking=123');

  assert.equal(jobs[1].title, 'Backend Lead');
  assert.equal(jobs[1].company, 'DataFlow Inc');
  assert.equal(jobs[1].location, 'New York, NY');
  assert.equal(jobs[1].url, 'https://www.linkedin.com/jobs/view/20002/?tracking=456');
});

test('Indeed: extracts single job detail page', () => {
  const doc = loadFixtureDoc(
    'indeed-detail.html',
    'https://www.indeed.com/viewjob?jk=abc123def456'
  );
  const job = extractIndeedJobDetails(doc);

  assert.ok(job);
  assert.equal(job.title, 'Senior Platform Engineer');
  assert.equal(job.company, 'CloudScale');
  assert.equal(job.location, 'Austin, TX');
  assert.equal(job.salary, '$160,000 - $190,000 a year');
  assert.ok(job.description.includes('maintaining Kubernetes clusters'));
  assert.equal(job.url, 'https://www.indeed.com/viewjob?jk=abc123def456');
  assert.equal(job.source, 'indeed');
});

test('Indeed: extracts search results cards', () => {
  const doc = loadFixtureDoc('indeed-search.html', 'https://www.indeed.com/jobs?q=devops');
  const jobs = extractIndeedSearchCards(doc);

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, 'DevOps Specialist');
  assert.equal(jobs[0].company, 'InfraCorp');
  assert.equal(jobs[0].location, 'Chicago, IL');
  assert.equal(jobs[0].url, 'https://www.indeed.com/viewjob?jk=98765fedcba');
  assert.ok(jobs[0].description.includes('multi-cloud'));

  assert.equal(jobs[1].title, 'Site Reliability Engineer');
  assert.equal(jobs[1].company, 'ReliableSystems');
  assert.equal(jobs[1].location, 'Remote');
  assert.equal(jobs[1].url, 'https://www.indeed.com/rc/clk?jk=55555aaaa');
});

test('Glassdoor: extracts job details page', () => {
  const doc = loadFixtureDoc(
    'glassdoor-detail.html',
    'https://www.glassdoor.com/job-listing/full-stack-developer-techventures-JV_IC1147401_KO0,20_KE21,33.htm?jl=100888999'
  );
  const job = extractGlassdoorJobDetails(doc);

  assert.ok(job);
  assert.equal(job.title, 'Full Stack Developer');
  assert.equal(job.company, 'TechVentures');
  assert.equal(job.location, 'New York, NY');
  assert.equal(job.salary, '$130K - $160K (Employer est.)');
  assert.ok(job.description.includes('React and Node.js'));
  assert.equal(job.source, 'glassdoor');
});

test('Naukri: extracts single job detail page', () => {
  const doc = loadFixtureDoc(
    'naukri-detail.html',
    'https://www.naukri.com/job-listings-backend-engineer-payments-fintech-india-bengaluru-5-to-8-years-180826000001'
  );
  const job = extractNaukriJobDetails(doc);

  assert.ok(job);
  assert.equal(job.title, 'Backend Engineer - Payments');
  assert.equal(job.company, 'FinTech India Pvt Ltd');
  assert.equal(job.location, 'Bengaluru / Bangalore');
  assert.equal(job.salary, '₹ 25,00,000 - 35,00,000 P.A.');
  assert.ok(job.description.includes('Java / Go'));
  assert.equal(job.source, 'naukri');
});

test('Naukri: extracts search results cards', () => {
  const doc = loadFixtureDoc('naukri-search.html', 'https://www.naukri.com/ai-ml-jobs');
  const jobs = extractNaukriSearchCards(doc);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'AI / ML Engineer');
  assert.equal(jobs[0].company, 'NextGen AI Labs');
  assert.equal(jobs[0].location, 'Pune, Hybrid');
  assert.equal(
    jobs[0].url,
    'https://www.naukri.com/job-listings-ai-ml-engineer-nextgen-pune-3-to-6-years-1010101'
  );
  assert.ok(jobs[0].description.includes('PyTorch'));
});

test('extractJobsFromDocument routes correctly', () => {
  const doc = loadFixtureDoc(
    'linkedin-detail.html',
    'https://www.linkedin.com/jobs/view/1234567890/'
  );
  const jobs = extractJobsFromDocument(doc);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Staff Software Engineer');
});

test('platform wrapper functions extract jobs cleanly', () => {
  const liDoc = loadFixtureDoc(
    'linkedin-detail.html',
    'https://www.linkedin.com/jobs/view/1234567890/'
  );
  assert.equal(extractLinkedIn(liDoc).length, 1);

  const inDoc = loadFixtureDoc('indeed-search.html', 'https://www.indeed.com/jobs?q=devops');
  assert.equal(extractIndeed(inDoc).length, 2);

  const gdDoc = loadFixtureDoc('glassdoor-detail.html', 'https://www.glassdoor.com/job-listing/1');
  assert.equal(extractGlassdoor(gdDoc).length, 1);
  assert.equal(extractGlassdoorSearchCards(gdDoc).length, 0);

  const nkDoc = loadFixtureDoc('naukri-detail.html', 'https://www.naukri.com/job-listings-1');
  assert.equal(extractNaukri(nkDoc).length, 1);
});
