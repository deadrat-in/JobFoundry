import { describe, it, expect } from 'vitest';
import { filterJobs, getScoreCategory, parseFitNotes } from '../filterUtils';
import { Job } from '../../../types/job';

const mockJobs: Job[] = [
  {
    id: '1',
    title: 'Senior Python Engineer',
    company: 'Alpha Corp',
    location: 'Remote',
    url: 'https://example.com/1',
    source: 'linkedin',
    liveness: 'active',
    fit_score: 92,
    status: 'new',
    created_at: 1000,
    updated_at: 1000,
  },
  {
    id: '2',
    title: 'Frontend React Developer',
    company: 'Beta Inc',
    location: 'San Francisco',
    url: 'https://example.com/2',
    source: 'indeed',
    liveness: 'active',
    fit_score: 65,
    status: 'rejected_by_score',
    created_at: 2000,
    updated_at: 2000,
  },
  {
    id: '3',
    title: 'DevOps Specialist',
    company: 'Gamma LLC',
    location: 'New York',
    url: 'https://example.com/3',
    source: 'greenhouse',
    liveness: 'active',
    fit_score: 80,
    status: 'tailored',
    created_at: 3000,
    updated_at: 3000,
  },
];

describe('filterJobs', () => {
  it('returns all jobs when no criteria provided', () => {
    expect(filterJobs(mockJobs, {})).toEqual(mockJobs);
  });

  it('filters by search term in title or company', () => {
    const res = filterJobs(mockJobs, { search: 'python' });
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('1');

    const res2 = filterJobs(mockJobs, { search: 'beta' });
    expect(res2).toHaveLength(1);
    expect(res2[0].id).toBe('2');
  });

  it('filters by status', () => {
    const res = filterJobs(mockJobs, { status: 'tailored' });
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('3');
  });

  it('filters by source', () => {
    const res = filterJobs(mockJobs, { source: 'indeed' });
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('2');
  });

  it('filters by min score threshold', () => {
    const res = filterJobs(mockJobs, { minScore: 75 });
    expect(res).toHaveLength(2);
    expect(res.map((j) => j.id)).toEqual(['1', '3']);
  });
});

describe('getScoreCategory', () => {
  it('categorizes scores based on threshold', () => {
    expect(getScoreCategory(85, 75)).toBe('high');
    expect(getScoreCategory(75, 75)).toBe('high');
    expect(getScoreCategory(60, 75)).toBe('medium');
    expect(getScoreCategory(30, 75)).toBe('low');
    expect(getScoreCategory(null, 75)).toBe('unscored');
  });
});

describe('parseFitNotes', () => {
  it('returns empty object when input is null, undefined, or empty', () => {
    expect(parseFitNotes(null)).toEqual({});
    expect(parseFitNotes(undefined)).toEqual({});
    expect(parseFitNotes('')).toEqual({});
    expect(parseFitNotes('   ')).toEqual({});
  });

  it('parses valid structured JSON fit_notes', () => {
    const raw = JSON.stringify({
      matching_skills: ['React', 'TypeScript'],
      missing_skills: ['Go'],
      reasoning: 'Strong frontend match',
    });
    expect(parseFitNotes(raw)).toEqual({
      matching_skills: ['React', 'TypeScript'],
      missing_skills: ['Go'],
      reasoning: 'Strong frontend match',
    });
  });

  it('parses the score_failed error message from JSON fit_notes', () => {
    const raw = JSON.stringify({
      error: 'No API key configured — go to Settings to add your LLM key.',
    });
    expect(parseFitNotes(raw)).toEqual({
      error: 'No API key configured — go to Settings to add your LLM key.',
    });
  });

  it('parses reasoning alongside the score_failed error', () => {
    const raw = JSON.stringify({
      error: 'No API key configured — go to Settings to add your LLM key.',
      reasoning: 'Scoring skipped',
    });
    expect(parseFitNotes(raw)).toEqual({
      error: 'No API key configured — go to Settings to add your LLM key.',
      reasoning: 'Scoring skipped',
    });
  });

  it('falls back to { reasoning: raw } when input is raw non-JSON text', () => {
    const raw = 'Great role, requires 5 years experience.';
    expect(parseFitNotes(raw)).toEqual({ reasoning: raw });
  });

  it('safely handles "null" JSON string without throwing', () => {
    expect(parseFitNotes('null')).toEqual({ reasoning: 'null' });
  });

  it('safely handles non-object JSON values like numbers or arrays', () => {
    expect(parseFitNotes('42')).toEqual({ reasoning: '42' });
    expect(parseFitNotes('true')).toEqual({ reasoning: 'true' });
    expect(parseFitNotes('["skill1", "skill2"]')).toEqual({ reasoning: '["skill1", "skill2"]' });
  });

  it('falls back to { reasoning: raw } when skills are not arrays or reasoning is not a string', () => {
    const invalidSkills = JSON.stringify({
      matching_skills: 'React, TypeScript', // string instead of array
      missing_skills: 123, // number instead of array
    });
    expect(parseFitNotes(invalidSkills)).toEqual({ reasoning: invalidSkills });

    const invalidReasoning = JSON.stringify({
      reasoning: { note: 'invalid object' },
    });
    expect(parseFitNotes(invalidReasoning)).toEqual({ reasoning: invalidReasoning });
  });
});
