import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compileKeyword,
  compilePositiveKeyword,
  buildTitleFilter,
} from '../src/background/filters/title-keywords.js';
import { buildLocationFilter } from '../src/background/filters/location-filter.js';
import { buildDateFilter } from '../src/background/filters/date-filter.js';
import { extractKeywordsFromResume } from '../src/background/filters/resume-keywords.js';

test('title-keywords: compileKeyword acronym boundary matching', () => {
  const matchAi = compileKeyword('ai');
  assert.equal(matchAi('senior ai engineer'), true);
  assert.equal(matchAi('ai research scientist'), true);
  assert.equal(matchAi('maintenance technician'), false); // "ai" inside maintenance

  const matchMl = compileKeyword('ml');
  assert.equal(matchMl('senior ml engineer'), true);
  assert.equal(matchMl('html developer'), false); // "ml" inside html
});

test('title-keywords: word: prefix whole-word matching', () => {
  const matchIntern = compileKeyword('word:intern');
  assert.equal(matchIntern('software engineering intern'), true);
  assert.equal(matchIntern('summer intern 2026'), true);
  assert.equal(matchIntern('internal tools engineer'), false); // "internal" is not "intern"
  assert.equal(matchIntern('international partnerships'), false);
});

test('title-keywords: stem: prefix matching', () => {
  const matchAgent = compileKeyword('stem:agent');
  assert.equal(matchAgent('ai agent builder'), true);
  assert.equal(matchAgent('agentic workflow engineer'), true);
  assert.equal(matchAgent('reagents chemist'), false); // "agent" inside reagents
});

test('title-keywords: + multi-term conjunction matching', () => {
  const matchDirectorEng = compilePositiveKeyword('director + engineering');
  assert.equal(matchDirectorEng('Director of Engineering'), true);
  assert.equal(matchDirectorEng('Engineering Director'), true);
  assert.equal(matchDirectorEng('Senior Director, Software Engineering'), true);
  assert.equal(matchDirectorEng('Director of Marketing'), false);
});

test('title-keywords: buildTitleFilter positive and negative matching', () => {
  const filter = buildTitleFilter({
    positive: ['software engineer', 'fullstack', 'react'],
    negative: ['word:intern', 'junior', 'php'],
  });

  // Matching positive and not negative
  assert.equal(filter('Senior Fullstack Engineer'), true);
  assert.equal(filter('React Frontend Developer'), true);
  assert.equal(filter('Lead Software Engineer'), true);

  // Rejected by negative
  assert.equal(filter('Software Engineering Intern'), false);
  assert.equal(filter('Junior React Developer'), false);
  assert.equal(filter('Fullstack PHP Developer'), false);

  // Rejected by not matching positive
  assert.equal(filter('Senior Sales Executive'), false);
});

test('location-filter: allow and block rules with remote fallback', () => {
  const filter = buildLocationFilter({
    allow: ['remote', 'united states'],
    block: ['hybrid', 'on-site only'],
  });

  assert.equal(filter({ location: 'Remote, US', title: 'Software Engineer' }), true);
  assert.equal(filter({ location: 'United States', title: 'Developer' }), true);
  assert.equal(filter({ location: 'Remote', title: 'Staff Engineer' }), true);

  // Blocked location
  assert.equal(filter({ location: 'Remote (Hybrid)', title: 'Engineer' }), false);
  assert.equal(filter({ location: 'On-site only, Austin, TX', title: 'Engineer' }), false);

  // Title signals remote even if location is unlisted/city
  assert.equal(filter({ location: 'Chicago, IL', title: 'Software Engineer - Remote' }), true);
});

test('date-filter: maxPostingAgeDays filtering', () => {
  const now = 1700000000000;
  const filter30Days = buildDateFilter(30, () => now);

  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const fortyDaysAgo = now - 40 * 24 * 60 * 60 * 1000;

  assert.equal(filter30Days({ postedAt: oneDayAgo }), true);
  assert.equal(filter30Days({ postedAt: fortyDaysAgo }), false);
  assert.equal(filter30Days({ postedAt: null }), true); // Null date preserved
});

test('resume-keywords: extract target roles from JSON resume', () => {
  const sampleResume = {
    basics: {
      name: 'Jane Doe',
      label: 'Senior Fullstack Engineer',
    },
    work: [{ position: 'Staff Frontend Engineer' }, { position: 'Software Engineer' }],
    skills: [{ name: 'TypeScript' }, { name: 'Solutions Architect' }],
  };

  const keywords = extractKeywordsFromResume(sampleResume);
  assert.ok(keywords.includes('Senior Fullstack Engineer'));
  assert.ok(keywords.includes('Staff Frontend Engineer'));
  assert.ok(keywords.includes('Software Engineer'));
  assert.ok(keywords.includes('Solutions Architect'));
});
