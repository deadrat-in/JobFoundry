#!/usr/bin/env node
/**
 * import-career-ops.mjs — One-way import utility from career-ops into JobFoundry.
 *
 * Reads pipeline.md (or applications.md) from a career-ops workspace and ingests
 * discovered job postings into JobFoundry via POST /api/v1/jobs/ingest.
 * Idempotent: JobFoundry's SimHash and URL deduplication automatically prevent duplicates.
 *
 * Usage:
 *   node scripts/import-career-ops.mjs --from /path/to/career-ops/data/pipeline.md
 *   node scripts/import-career-ops.mjs --from /path/to/career-ops --server http://localhost:8080 --key <apiKey>
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

function getArg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const fromArg = getArg('--from');
const serverUrl = (getArg('--server') || process.env.JOBFOUNDRY_SERVER_URL || 'http://localhost:8080').replace(/\/+$/, '');
const apiKey = getArg('--key') || process.env.JOBFOUNDRY_API_KEY || 'testkey';

if (!fromArg) {
  console.error('Usage: node scripts/import-career-ops.mjs --from <path-to-pipeline.md-or-career-ops-dir> [--server <url>] [--key <apiKey>]');
  process.exit(1);
}

let targetFile = resolve(fromArg);
if (existsSync(targetFile) && statSync(targetFile).isDirectory()) {
  const candidate = join(targetFile, 'data', 'pipeline.md');
  if (existsSync(candidate)) {
    targetFile = candidate;
  } else {
    console.error(`Could not find data/pipeline.md inside directory: ${targetFile}`);
    process.exit(1);
  }
}

if (!existsSync(targetFile)) {
  console.error(`File not found: ${targetFile}`);
  process.exit(1);
}

console.log(`Reading career-ops postings from: ${targetFile}`);
const content = readFileSync(targetFile, 'utf8');
const lines = content.split('\n');

const jobs = [];
const URL_REGEX = /(https?:\/\/[^\s|\]]+)/i;

for (const rawLine of lines) {
  const line = rawLine.trim();
  if (!line) continue;

  // Pattern 1: Checkbox entry in pipeline.md: "- [ ] https://... | Company | Title | Location"
  if (line.startsWith('- [ ]') || line.startsWith('- [x]')) {
    const match = line.match(URL_REGEX);
    if (!match) continue;

    const url = match[1];
    const segments = line
      .replace(/^- \[[ x!]\]\s*/i, '')
      .split('|')
      .map((s) => s.trim());

    // Extract optional metadata segments
    let company = 'Unknown';
    let title = 'Job Opportunity';
    let location = null;
    let postedAt = null;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.startsWith('http')) continue;
      if (seg.startsWith('posted:')) {
        const dateStr = seg.replace(/^posted:\s*/i, '').trim();
        const parsed = Date.parse(dateStr);
        if (!Number.isNaN(parsed)) postedAt = parsed;
        continue;
      }
      if (seg.startsWith('note:')) continue;

      if (company === 'Unknown') {
        company = seg;
      } else if (title === 'Job Opportunity') {
        title = seg;
      } else if (!location) {
        location = seg;
      }
    }

    // Infer source from URL
    let source = 'career-ops';
    if (url.includes('greenhouse.io')) source = 'greenhouse';
    else if (url.includes('lever.co')) source = 'lever';
    else if (url.includes('ashbyhq.com')) source = 'ashby';
    else if (url.includes('workday.com') || url.includes('myworkdayjobs.com')) source = 'workday';

    jobs.push({
      title,
      company,
      location,
      url,
      source,
      postedAt: postedAt || undefined,
    });
  }
}

if (jobs.length === 0) {
  console.log('No pending or eligible job entries found in file.');
  process.exit(0);
}

console.log(`Parsed ${jobs.length} job(s). Ingesting to JobFoundry at ${serverUrl}...`);

async function runImport() {
  try {
    const response = await fetch(`${serverUrl}/api/v1/jobs/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jobs }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Ingest failed (HTTP ${response.status}): ${errText}`);
      process.exit(1);
    }

    const resJson = await response.json();
    console.log('\n=== Import Summary ===');
    console.log(`Total Parsed:   ${jobs.length}`);
    console.log(`New Ingested:   ${resJson.ingested ?? 0}`);
    console.log(`Deduplicated:   ${resJson.deduped ?? 0}`);
    console.log(`Processed IDs:  ${(resJson.ids || []).length}`);
    console.log('Done.');
  } catch (err) {
    console.error(`Network error connecting to JobFoundry server: ${err.message}`);
    process.exit(1);
  }
}

runImport();
