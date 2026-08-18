import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from '../App';
import { Job } from '../types/job';

const mockJobs: Job[] = [
  {
    id: 'job-1',
    title: 'Lead Architect',
    company: 'NextGen Systems',
    location: 'Remote',
    url: 'https://example.com/job-1',
    source: 'linkedin',
    liveness: 'active',
    fit_score: 95,
    fit_notes: JSON.stringify({
      reasoning: 'Exceptional architectural alignment',
      matching_skills: ['Python', 'Distributed Systems'],
      missing_skills: [],
    }),
    status: 'new',
    created_at: Date.now(),
    updated_at: Date.now(),
  },
];

describe('App', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ jobs: mockJobs }),
    });
  });

  it('renders JobFoundry navbar and live metrics', async () => {
    render(<App />);

    expect(screen.getByText('Job')).toBeInTheDocument();
    expect(screen.getByText('Foundry')).toBeInTheDocument();
    expect(screen.getByText('Total Ingested Jobs')).toBeInTheDocument();
    expect(screen.getByText('Average Fit Score')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Lead Architect')).toBeInTheDocument();
      expect(screen.getByText('NextGen Systems')).toBeInTheDocument();
    });
  });
});
