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

test('extractJsonLd: parses Schema.org JobPosting correctly', async () => {
  const { extractJsonLd } = await import('../src/content/extractors/helpers.js');
  const html = `
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org/",
          "@type": "JobPosting",
          "title": "Senior AI Infrastructure Engineer",
          "description": "<p>Build high-scale AI systems &amp; clusters.</p><ul><li>5+ years Python/C++</li><li>Kubernetes experience</li></ul>",
          "hiringOrganization": {
            "@type": "Organization",
            "name": "Anthropic AI"
          },
          "jobLocation": {
            "@type": "Place",
            "address": {
              "addressLocality": "San Francisco",
              "addressRegion": "CA",
              "addressCountry": "USA"
            }
          },
          "datePosted": "2026-08-20"
        }
        </script>
      </head>
      <body></body>
    </html>
  `;
  const dom = new JSDOM(html, { url: 'https://careers.example.com/job/ai-eng' });
  const job = extractJsonLd(dom.window.document);

  assert.ok(job);
  assert.equal(job.title, 'Senior AI Infrastructure Engineer');
  assert.equal(job.company, 'Anthropic AI');
  assert.equal(job.location, 'San Francisco, CA, USA');
  assert.ok(job.description.includes('Build high-scale AI systems & clusters.'));
  assert.ok(job.description.includes('- 5+ years Python/C++'));
  assert.equal(job.source, 'json-ld');
});

test('jdHtmlToText: decodes entities and formats block elements cleanly', async () => {
  const { jdHtmlToText } = await import('../src/content/extractors/helpers.js');
  const input =
    '<h2>About Us</h2><p>We are building the future &amp; hiring <strong>engineers</strong>.</p><ul><li>Go &amp; Rust</li><li>Distributed systems</li></ul>';
  const out = jdHtmlToText(input);

  assert.ok(out.includes('About Us'));
  assert.ok(out.includes('We are building the future & hiring engineers'));
  assert.ok(out.includes('- Go & Rust'));
  assert.ok(out.includes('- Distributed systems'));
});

test('extractGenericJob: extracts from article and semantic main content', async () => {
  const { extractGenericJob } = await import('../src/content/extractors/ats.js');
  const html = `
    <html>
      <head><title>Staff Systems Engineer - Acme Tech</title></head>
      <body>
        <nav><a href="/">Home</a><a href="/jobs">Careers</a></nav>
        <main>
          <h1>Staff Systems Engineer</h1>
          <article>
            <p>Acme Tech is looking for a Staff Systems Engineer to scale our global edge network.</p>
            <p>You will architect low-latency networking software and mentor teammates.</p>
          </article>
        </main>
        <footer>Copyright 2026</footer>
      </body>
    </html>
  `;
  const dom = new JSDOM(html, { url: 'https://acme.tech/careers/staff-eng' });
  const jobs = extractGenericJob(dom.window.document);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Staff Systems Engineer');
  assert.ok(
    jobs[0].description.includes('Staff Systems Engineer to scale our global edge network')
  );
  assert.equal(jobs[0].source, 'web');
});

test('expandTruncatedContent clicks show-more button', async () => {
  const { expandTruncatedContent } = await import('../src/content/extractors/helpers.js');
  const dom = new JSDOM(`
    <div>
      <p id="desc">Short preview...</p>
      <button class="show-more-less-html__button--more">Show more</button>
    </div>
  `);
  let clicked = false;
  const btn = dom.window.document.querySelector('button');
  btn.addEventListener('click', () => {
    clicked = true;
  });

  expandTruncatedContent(dom.window.document);
  assert.equal(clicked, true);
});

test('isDescriptionIncomplete identifies truncated or tiny descriptions', async () => {
  const { isDescriptionIncomplete } = await import('../src/content/extractors/helpers.js');
  assert.equal(isDescriptionIncomplete(''), true);
  assert.equal(isDescriptionIncomplete('Too short to be a valid full job description'), true);
  assert.equal(
    isDescriptionIncomplete(
      'We are looking for a Senior Staff Distributed Systems Engineer with 10+ years of experience in Go, Rust, and Kubernetes to lead our core infrastructure initiatives and mentor team members... see more'
    ),
    true
  );
  // Full text > 250 characters without trailing ellipsis
  const fullText =
    'We are looking for a Senior Staff Distributed Systems Engineer with 10+ years of experience in Go, Rust, and Kubernetes to lead our core infrastructure initiatives and mentor team members across multiple timezones. Responsibilities include architecture design, reliability engineering, on-call support, and cross-functional alignment with product managers.';
  assert.equal(isDescriptionIncomplete(fullText), false);
});

test('cleanBoilerplate strips EEOC statements and preserves requirements', async () => {
  const { cleanBoilerplate } = await import('../src/content/extractors/helpers.js');
  const raw = `
About the Job:
We need a Senior Backend Engineer proficient with TypeScript and PostgreSQL.

Responsibilities:
- Build APIs
- Improve latency

Equal Opportunity Employer:
We are an equal opportunity employer and do not discriminate based on race, gender, religion, age, or sexual orientation. All qualified applicants will receive consideration.

We participate in E-Verify.
  `;
  const cleaned = cleanBoilerplate(raw);
  assert.ok(cleaned.includes('Senior Backend Engineer proficient with TypeScript'));
  assert.ok(cleaned.includes('Build APIs'));
  assert.ok(!cleaned.toLowerCase().includes('equal opportunity employer'));
  assert.ok(!cleaned.toLowerCase().includes('we participate in e-verify'));
});

test('LinkedIn: rejects noise titles such as 0 notifications and notifications page', async () => {
  const { isNoiseTitle } = await import('../src/content/extractors/helpers.js');
  assert.equal(isNoiseTitle('0 notifications'), true);
  assert.equal(isNoiseTitle('1 notification'), true);
  assert.equal(isNoiseTitle('Feed detail update'), true);
  assert.equal(isNoiseTitle('Software Engineer'), false);

  const html = `
    <html>
      <header><h1>0 notifications</h1></header>
      <body>
        <main><p>Notifications and user activity feed...</p></main>
      </body>
    </html>
  `;
  const dom = new JSDOM(html, { url: 'https://www.linkedin.com/notifications/?filter=all' });
  const results = extractJobsFromDocument(dom.window.document);
  assert.equal(results.length, 0);

  const detail = extractLinkedInJobDetails(dom.window.document);
  assert.equal(detail, null);
});

