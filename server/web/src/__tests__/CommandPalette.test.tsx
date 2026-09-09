import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CommandPalette } from '../components/CommandPalette';
import { ThemeProvider } from '../context/ThemeContext';
import { ToastProvider } from '../context/ToastContext';
import { Job } from '../types/job';

const mockJobs: Job[] = [
  {
    id: 'job-1',
    title: 'Senior Rust Engineer',
    company: 'Distributed Labs',
    location: 'Remote',
    url: 'https://example.com/rust',
    source: 'linkedin',
    liveness: 'active',
    fit_score: 92,
    status: 'new',
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 'job-2',
    title: 'Staff Fullstack Architect',
    company: 'Cloud Scale Corp',
    location: 'San Francisco, CA',
    url: 'https://example.com/staff',
    source: 'indeed',
    liveness: 'active',
    fit_score: 78,
    status: 'applied',
    created_at: Date.now(),
    updated_at: Date.now(),
  },
];

describe('CommandPalette', () => {
  it('renders search input and category items when open', () => {
    const handleClose = vi.fn();
    const handleOpenAddJob = vi.fn();
    const handleRefreshJobs = vi.fn();

    render(
      <MemoryRouter>
        <ThemeProvider>
          <ToastProvider>
            <CommandPalette
              isOpen={true}
              onClose={handleClose}
              jobs={mockJobs}
              onOpenAddJob={handleOpenAddJob}
              onRefreshJobs={handleRefreshJobs}
            />
          </ToastProvider>
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.getByPlaceholderText(/Type a command or search/i)).toBeInTheDocument();
    expect(screen.getByText('Job Feed')).toBeInTheDocument();
    expect(screen.getByText('Application Tracker')).toBeInTheDocument();
  });

  it('filters results by query', () => {
    const handleClose = vi.fn();

    render(
      <MemoryRouter>
        <ThemeProvider>
          <ToastProvider>
            <CommandPalette
              isOpen={true}
              onClose={handleClose}
              jobs={mockJobs}
              onOpenAddJob={vi.fn()}
              onRefreshJobs={vi.fn()}
            />
          </ToastProvider>
        </ThemeProvider>
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/Type a command or search/i);
    fireEvent.change(input, { target: { value: 'Rust' } });

    expect(screen.getByText(/Senior Rust Engineer/i)).toBeInTheDocument();
    expect(screen.queryByText(/Staff Fullstack Architect/i)).not.toBeInTheDocument();
  });

  it('calls onClose when ESC key is pressed', () => {
    const handleClose = vi.fn();

    render(
      <MemoryRouter>
        <ThemeProvider>
          <ToastProvider>
            <CommandPalette
              isOpen={true}
              onClose={handleClose}
              jobs={mockJobs}
              onOpenAddJob={vi.fn()}
              onRefreshJobs={vi.fn()}
            />
          </ToastProvider>
        </ThemeProvider>
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/Type a command or search/i);
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
