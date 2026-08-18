import { describe, it, expect } from 'vitest';
import { filterJobs, getScoreCategory } from '../filterUtils';
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
