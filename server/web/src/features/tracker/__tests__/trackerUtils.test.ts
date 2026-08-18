import { describe, it, expect } from 'vitest';
import { KANBAN_COLUMNS, isMoveAllowed } from '../trackerUtils';

describe('trackerUtils', () => {
  it('defines the standard application tracking columns', () => {
    const ids = KANBAN_COLUMNS.map((c) => c.id);
    expect(ids).toContain('new');
    expect(ids).toContain('saved');
    expect(ids).toContain('tailored');
    expect(ids).toContain('applied');
    expect(ids).toContain('interview');
    expect(ids).toContain('offer');
    expect(ids).toContain('rejected');
  });

  it('validates forward and valid transitions', () => {
    expect(isMoveAllowed('new', 'saved')).toBe(true);
    expect(isMoveAllowed('saved', 'applied')).toBe(true);
    expect(isMoveAllowed('applied', 'interview')).toBe(true);
    expect(isMoveAllowed('interview', 'offer')).toBe(true);
    expect(isMoveAllowed('new', 'rejected')).toBe(true);
    expect(isMoveAllowed('interview', 'rejected')).toBe(true);
  });
});
