import { describe, it, expect } from 'vitest';
import { computeResumeDiff } from '../diff';

describe('computeResumeDiff', () => {
  const originalResume = {
    basics: {
      name: 'Alex Smith',
      label: 'Software Engineer',
      summary: 'General backend engineer with Python skills.',
    },
    work: [
      {
        company: 'Cloud Corp',
        position: 'Backend Dev',
        highlights: ['Maintained legacy Python 2 codebase', 'Built REST APIs in Flask'],
      },
    ],
    skills: [
      {
        name: 'Backend',
        keywords: ['Python', 'Flask', 'MySQL'],
      },
    ],
  };

  const tailoredResume = {
    basics: {
      name: 'Alex Smith',
      label: 'Senior Distributed Systems Architect',
      summary:
        'Senior distributed systems engineer specializing in high-throughput Python and FastAPI microservices.',
    },
    work: [
      {
        company: 'Cloud Corp',
        position: 'Backend Dev',
        highlights: [
          'Architected high-throughput REST APIs in FastAPI',
          'Built REST APIs in Flask',
        ],
      },
    ],
    skills: [
      {
        name: 'Backend',
        keywords: ['Python', 'FastAPI', 'Flask', 'MySQL', 'Docker'],
      },
    ],
  };

  it('detects summary and label modifications in basics', () => {
    const diff = computeResumeDiff(originalResume, tailoredResume);
    expect(diff.basics.labelChange).toEqual({
      original: 'Software Engineer',
      tailored: 'Senior Distributed Systems Architect',
    });
    expect(diff.basics.summaryChange).toBeDefined();
  });

  it('detects added and removed work highlights', () => {
    const diff = computeResumeDiff(originalResume, tailoredResume);
    expect(diff.work).toHaveLength(1);
    const workDiff = diff.work[0];
    expect(workDiff.company).toBe('Cloud Corp');

    const addedHighlights = workDiff.highlights.filter((h) => h.type === 'added');
    const removedHighlights = workDiff.highlights.filter((h) => h.type === 'removed');
    const unchangedHighlights = workDiff.highlights.filter((h) => h.type === 'unchanged');

    expect(addedHighlights).toHaveLength(1);
    expect(addedHighlights[0].text).toContain('FastAPI');
    expect(removedHighlights).toHaveLength(1);
    expect(removedHighlights[0].text).toContain('Python 2');
    expect(unchangedHighlights).toHaveLength(1);
    expect(unchangedHighlights[0].text).toContain('Flask');
  });

  it('detects skill additions', () => {
    const diff = computeResumeDiff(originalResume, tailoredResume);
    const skillDiff = diff.skills[0];
    expect(skillDiff.name).toBe('Backend');
    const addedKeywords = skillDiff.keywords.filter((k) => k.type === 'added').map((k) => k.text);
    expect(addedKeywords).toContain('FastAPI');
    expect(addedKeywords).toContain('Docker');
  });
});
