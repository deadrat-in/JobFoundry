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
    localStorage.clear();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            user: { id: 'u1', email: 'test@example.com', name: 'Tester', apiKey: 'jf_test' },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ jobs: mockJobs, resumes: [] }),
      });
    });
  });

  it('renders login view when unauthenticated', async () => {
    render(<App />);
    expect(
      screen.getByText('Sign in to access your automated job command center')
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
  });

  it('renders dashboard when logged in with stored session', async () => {
    localStorage.setItem('jf_auth_token', 'valid-jwt-token');
    localStorage.setItem(
      'jf_auth_user',
      JSON.stringify({ id: 'u1', email: 'test@example.com', name: 'Tester', apiKey: 'jf_test' })
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Job')).toBeInTheDocument();
      expect(screen.getByText('Foundry')).toBeInTheDocument();
      expect(screen.getByText('Total Ingested Jobs')).toBeInTheDocument();
      expect(screen.getByText('Average Fit Score')).toBeInTheDocument();
      expect(screen.getByText('Lead Architect')).toBeInTheDocument();
    });
  });
});
