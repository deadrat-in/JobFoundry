import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddJobModal } from '../AddJobModal';
import { api } from '../../../api/client';

describe('AddJobModal', () => {
  it('renders paste tab by default and switches to manual tab', () => {
    const onClose = vi.fn();
    const onJobAdded = vi.fn();

    render(<AddJobModal onClose={onClose} onJobAdded={onJobAdded} />);

    expect(screen.getByText('Add Job to Pipeline')).toBeDefined();
    expect(screen.getByText('⚡ Paste JD & Auto-Parse (AI)')).toBeDefined();
    expect(screen.getByText('✏️ Job Details & Review')).toBeDefined();

    // Click Manual tab
    fireEvent.click(screen.getByText('✏️ Job Details & Review'));
    expect(screen.getByText('Job Title *')).toBeDefined();
    expect(screen.getByText('Company Name *')).toBeDefined();
  });

  it('handles auto-parse with AI and auto-populates manual fields', async () => {
    const onClose = vi.fn();
    const onJobAdded = vi.fn();

    vi.spyOn(api, 'parseJd').mockResolvedValueOnce({
      ok: true,
      job: {
        title: 'Senior AI Engineer',
        company: 'Anthropic',
        location: 'San Francisco, CA',
        salary: '$200k - $250k',
        employmentType: 'Full-time',
        description: 'AI Infrastructure and model evaluation.',
        requirements: ['Python', 'LLM evaluation'],
        url: 'https://jobs.example.com/ai-eng',
      },
    });

    render(<AddJobModal onClose={onClose} onJobAdded={onJobAdded} />);

    const textarea = screen.getByPlaceholderText('Paste the full job description, requirements, or web page text here...');
    fireEvent.change(textarea, { target: { value: '# Senior AI Engineer at Anthropic\nLocation: San Francisco, CA' } });

    const parseBtn = screen.getByText('✨ Auto-Parse with AI');
    fireEvent.click(parseBtn);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Senior AI Engineer')).toBeDefined();
      expect(screen.getByDisplayValue('Anthropic')).toBeDefined();
    });
  });
});
