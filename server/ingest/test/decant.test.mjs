import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decantHtml } from '../src/jobs/decant.mjs';

test('decantHtml extracts Tier 1 JSON-LD JobPosting description', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "title": "Principal Engineer",
            "description": "<p>We are seeking a <strong>Principal Engineer</strong> with deep Node.js and distributed systems background.</p><ul><li>Lead systems architecture</li><li>Scale PostgreSQL</li></ul>"
          }
        </script>
      </head>
      <body>
        <nav><a href="/">Home</a></nav>
        <div class="banner">Some non-job marketing content</div>
      </body>
    </html>
  `;
  const result = decantHtml(html);
  assert.ok(result.includes('Principal Engineer'));
  assert.ok(result.includes('Lead systems architecture'));
  assert.ok(!result.includes('Some non-job marketing content'));
});

test('decantHtml extracts Tier 2 semantic container', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Job</title></head>
      <body>
        <header><nav>Navigation links</nav></header>
        <article class="job-description">
          <h2>About the Role</h2>
          <p>Join our fast-growing fintech startup as an Engineering Director.</p>
          <ul>
            <li>Own roadmaps</li>
            <li>Hire high-caliber talent</li>
          </ul>
        </article>
        <footer>Company footer copyright 2026</footer>
      </body>
    </html>
  `;
  const result = decantHtml(html);
  assert.ok(result.includes('About the Role'));
  assert.ok(result.includes('Engineering Director'));
  assert.ok(!result.includes('Navigation links'));
  assert.ok(!result.includes('Company footer copyright'));
});

test('decantHtml Tier 3 strips chrome, nav, forms, footers and decants readable body', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <body>
        <nav><a href="/">Home</a><a href="/jobs">Jobs</a></nav>
        <div role="dialog">Cookie consent popup</div>
        <form><input type="text" /><button>Submit</button></form>
        <h1>Staff Product Manager</h1>
        <p>This is a strategic role responsible for defining product roadmaps, user stories, and cross-functional leadership across our platform teams.</p>
        <p>Requirements include 5+ years in B2B SaaS and high technical literacy.</p>
        <footer>Privacy Policy | Terms of Service</footer>
      </body>
    </html>
  `;
  const result = decantHtml(html);
  assert.ok(result.includes('Staff Product Manager'));
  assert.ok(result.includes('defining product roadmaps'));
  assert.ok(!result.includes('Cookie consent popup'));
  assert.ok(!result.includes('Privacy Policy'));
  assert.ok(!result.includes('Home'));
});
