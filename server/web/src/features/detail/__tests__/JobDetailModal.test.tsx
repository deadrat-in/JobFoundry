import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JobDetailModal } from '../JobDetailModal';
import { Job } from '../../../types/job';

vi.mock('../../tailor/TailorButton', () => ({
  TailorButton: () => <button type="button">Tailor CV</button>,
}));

const baseJob: Job = {
  id: 'job-1',
  title: 'Platform Engineer',
  company: 'Acme',
  location: 'Remote',
  url: 'https://jobs.example.com/1',
  source: 'web',
  liveness: 'active',
  status: 'new',
  description: 'Build reliable distributed systems.',
  created_at: 1700000000000,
  updated_at: 1700000000000,
};

function renderModal(url: string) {
  return render(
    <JobDetailModal
      job={{ ...baseJob, url }}
      onClose={vi.fn()}
      onStatusChange={vi.fn()}
      onJobUpdated={vi.fn()}
    />
  );
}

describe('JobDetailModal external job link', () => {
  it.each(['javascript:alert(1)', 'data:text/html,malicious', '//evil.example/job', '/relative'])(
    'replaces unsafe URL %s with a non-navigating href',
    (url) => {
      renderModal(url);

      expect(screen.getByRole('link', { name: /View Original/ })).toHaveAttribute('href', '#');
    }
  );

  it.each([
    ['https://jobs.example.com/1', 'https://jobs.example.com/1'],
    ['http://jobs.example.com/2', 'http://jobs.example.com/2'],
    ['  HTTPS://jobs.example.com/3  ', 'https://jobs.example.com/3'],
  ])('preserves supported HTTP(S) URL %s', (url, expected) => {
    renderModal(url);

    expect(screen.getByRole('link', { name: /View Original/ })).toHaveAttribute('href', expected);
  });
});
