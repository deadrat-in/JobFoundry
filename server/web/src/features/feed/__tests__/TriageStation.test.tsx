import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JobFeed } from '../JobFeed';
import { TriageListItem } from '../TriageListItem';
import { JobWorkbench } from '../JobWorkbench';
import { Job } from '../../../types/job';

const mockJobs: Job[] = [
  {
    id: 'job-1',
    title: 'Senior Staff Engineer',
    company: 'Alpha Corp',
    location: 'Remote',
    url: 'https://example.com/alpha',
    source: 'linkedin',
    liveness: 'active',
    fit_score: 92,
    fit_notes: JSON.stringify({
      reasoning: 'Superb architecture background and systems experience',
      matching_skills: ['TypeScript', 'Fastify', 'Docker'],
      missing_skills: ['Kubernetes'],
    }),
    description:
      'We are seeking a seasoned Senior Staff Engineer to lead core platform architecture.',
    status: 'new',
    created_at: Date.now() - 10000,
    updated_at: Date.now() - 10000,
  },
  {
    id: 'job-2',
    title: 'Lead Frontend Developer',
    company: 'Beta Labs',
    location: 'San Francisco, CA',
    url: 'https://example.com/beta',
    source: 'greenhouse',
    liveness: 'active',
    fit_score: 84,
    fit_notes: JSON.stringify({
      reasoning: 'Strong React, modern CSS, and component design skills',
      matching_skills: ['React', 'CSS', 'Vite'],
      missing_skills: [],
    }),
    description: 'Lead frontend initiatives across responsive web and browser extension products.',
    status: 'saved',
    created_at: Date.now() - 5000,
    updated_at: Date.now() - 5000,
  },
];

describe('TriageStation & Split View', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders TriageListItem with score pill and company details', () => {
    const handleSelect = vi.fn();
    render(
      <TriageListItem job={mockJobs[0]} threshold={75} isActive={true} onSelect={handleSelect} />
    );

    expect(screen.getByText('Senior Staff Engineer')).toBeInTheDocument();
    expect(screen.getByText('Alpha Corp')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
    expect(screen.getByText('linkedin')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Senior Staff Engineer'));
    expect(handleSelect).toHaveBeenCalledTimes(1);
  });

  it('renders JobWorkbench with details, fit evaluation, and description', () => {
    const handleStatusChange = vi.fn();
    const handleJobUpdated = vi.fn();

    render(
      <JobWorkbench
        job={mockJobs[0]}
        threshold={75}
        onStatusChange={handleStatusChange}
        onJobUpdated={handleJobUpdated}
      />
    );

    expect(screen.getByText('Fit Screener Evaluation')).toBeInTheDocument();
    expect(screen.getByText(/Superb architecture background/)).toBeInTheDocument();
    expect(screen.getByText('Matching Skills (3)')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('Gaps / Missing Skills (1)')).toBeInTheDocument();
    expect(screen.getByText('Kubernetes')).toBeInTheDocument();
    expect(screen.getByText(/We are seeking a seasoned Senior Staff Engineer/)).toBeInTheDocument();
  });

  it('renders JobFeed in Split View by default and allows toggling to Cards view', () => {
    const handleSelect = vi.fn();
    render(<JobFeed jobs={mockJobs} onSelectJob={handleSelect} />);

    // Keyboard hint bar
    expect(screen.getByText('Quick Triage:')).toBeInTheDocument();
    expect(screen.getByText('Jobs Queue (2)')).toBeInTheDocument();

    // Toggle to cards
    const cardsBtn = screen.getByRole('button', { name: /Cards/i });
    fireEvent.click(cardsBtn);

    expect(localStorage.getItem('jf_feed_view_mode')).toBe('grid');

    // Toggle back to split view
    const splitBtn = screen.getByRole('button', { name: /Split View/i });
    fireEvent.click(splitBtn);

    expect(localStorage.getItem('jf_feed_view_mode')).toBe('split');
  });

  it('navigates jobs using keyboard shortcut j and k', () => {
    const handleSelect = vi.fn();
    render(<JobFeed jobs={mockJobs} onSelectJob={handleSelect} />);

    // Initial job active is the highest score (job-1, Alpha Corp)
    expect(screen.getByText(/Superb architecture background/)).toBeInTheDocument();

    // Press 'j' to step to next job (job-2, Beta Labs)
    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getByText(/Strong React, modern CSS/)).toBeInTheDocument();

    // Press 'k' to step back to job-1
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByText(/Superb architecture background/)).toBeInTheDocument();
  });

  it('opens posting on keyboard shortcut o', () => {
    const handleSelect = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<JobFeed jobs={mockJobs} onSelectJob={handleSelect} />);

    fireEvent.keyDown(window, { key: 'o' });
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/alpha',
      '_blank',
      'noopener,noreferrer'
    );
    openSpy.mockRestore();
  });

  it('triggers status changes on s (save), e (dismiss), and a (apply)', () => {
    const handleSelect = vi.fn();
    const handleStatusChange = vi.fn();

    render(
      <JobFeed jobs={mockJobs} onSelectJob={handleSelect} onStatusChange={handleStatusChange} />
    );

    // Press 's' to toggle saved
    fireEvent.keyDown(window, { key: 's' });
    expect(handleStatusChange).toHaveBeenCalledWith('job-1', 'saved');

    // Press 'e' to archive
    fireEvent.keyDown(window, { key: 'e' });
    expect(handleStatusChange).toHaveBeenCalledWith('job-1', 'archived');

    // Press 'a' to mark applied
    fireEvent.keyDown(window, { key: 'a' });
    expect(handleStatusChange).toHaveBeenCalledWith('job-1', 'applied');
  });

  it('jumps to bottom of list with Shift+G', () => {
    const handleSelect = vi.fn();
    render(<JobFeed jobs={mockJobs} onSelectJob={handleSelect} />);

    expect(screen.getByText(/Superb architecture background/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'G' });
    expect(screen.getByText(/Strong React, modern CSS/)).toBeInTheDocument();
  });

  it('opens and closes keyboard shortcuts help modal with ? and Esc', () => {
    const handleSelect = vi.fn();
    render(<JobFeed jobs={mockJobs} onSelectJob={handleSelect} />);

    // Press '?' to open modal
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Triage & Actions')).toBeInTheDocument();

    // Press 'Escape' to close modal
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Triage & Actions')).not.toBeInTheDocument();
  });

  it('renders TriageListItem safely when fit_notes is string "null" and sets aria-current', () => {
    const jobWithNullNotes: Job = {
      ...mockJobs[0],
      id: 'job-null-notes',
      fit_notes: 'null',
    };
    render(
      <TriageListItem job={jobWithNullNotes} threshold={75} isActive={true} onSelect={vi.fn()} />
    );
    const item = screen.getByRole('button');
    expect(item).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Senior Staff Engineer')).toBeInTheDocument();
  });

  it('does not trigger triage shortcuts when modifier keys are pressed', () => {
    const handleStatusChange = vi.fn();
    render(<JobFeed jobs={mockJobs} onSelectJob={vi.fn()} onStatusChange={handleStatusChange} />);

    // Ctrl+S or Cmd+A should not trigger status change
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(handleStatusChange).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'a', metaKey: true });
    expect(handleStatusChange).not.toHaveBeenCalled();
  });
});
