import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ScraperSettingsTab } from '../ScraperSettingsTab';
import { ExtensionConfig } from '../../../api/client';

describe('ScraperSettingsTab', () => {
  const sampleConfig: ExtensionConfig = {
    scanIntervalHours: 6,
    passiveMode: true,
    activeMode: false,
    maxPostingAgeDays: 30,
    titleFilter: {
      positive: ['Software Engineer', 'Backend'],
      negative: ['intern', 'junior'],
    },
    locationFilter: {
      allow: ['remote', 'worldwide'],
      block: ['hybrid'],
    },
    portals: {
      himalayas: true,
      remoteok: false,
      arbeitnow: true,
    },
    trackedCompanies: [],
  };

  it('renders title keywords, negative keywords, and portal catalog', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const onExtractFromResume = vi.fn();

    render(
      <ScraperSettingsTab
        config={sampleConfig}
        onChange={onChange}
        onSave={onSave}
        saving={false}
        onExtractFromResume={onExtractFromResume}
        extractingResume={false}
      />
    );

    expect(screen.getByText('Scrapers & Search Filters')).toBeInTheDocument();
    expect(screen.getByText('Target Role Keywords (Positive Matches)')).toBeInTheDocument();
    expect(screen.getByText('Negative Excluded Keywords')).toBeInTheDocument();
    expect(screen.getByText('Himalayas')).toBeInTheDocument();
    expect(screen.getByText('RemoteOK')).toBeInTheDocument();
  });

  it('filters portals based on search query', () => {
    const onChange = vi.fn();

    render(
      <ScraperSettingsTab
        config={sampleConfig}
        onChange={onChange}
        onSave={vi.fn()}
        saving={false}
        onExtractFromResume={vi.fn()}
        extractingResume={false}
      />
    );

    const searchInput = screen.getByPlaceholderText(/Search portals/i);
    fireEvent.change(searchInput, { target: { value: 'Himalayas' } });

    expect(screen.getByText('Himalayas')).toBeInTheDocument();
    expect(screen.queryByText('RemoteOK')).not.toBeInTheDocument();
  });

  it('toggles an individual portal when clicked', () => {
    const onChange = vi.fn();

    render(
      <ScraperSettingsTab
        config={sampleConfig}
        onChange={onChange}
        onSave={vi.fn()}
        saving={false}
        onExtractFromResume={vi.fn()}
        extractingResume={false}
      />
    );

    // Click on RemoteOK toggle
    const remoteOkLabel = screen.getByText(/RemoteOK/).closest('label');
    expect(remoteOkLabel).toBeTruthy();
    const checkbox = remoteOkLabel?.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox!);

    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0];
    expect(updated.portals.remoteok).toBe(true);
  });

  it('calls onSave when save button is clicked', () => {
    const onSave = vi.fn();

    render(
      <ScraperSettingsTab
        config={sampleConfig}
        onChange={vi.fn()}
        onSave={onSave}
        saving={false}
        onExtractFromResume={vi.fn()}
        extractingResume={false}
      />
    );

    const saveButtons = screen.getAllByRole('button', { name: /Save Filters & Scrapers/i });
    expect(saveButtons.length).toBeGreaterThan(0);
    fireEvent.click(saveButtons[0]);

    expect(onSave).toHaveBeenCalled();
  });

  it('calls onExtractFromResume when button is clicked', () => {
    const onExtract = vi.fn();

    render(
      <ScraperSettingsTab
        config={sampleConfig}
        onChange={vi.fn()}
        onSave={vi.fn()}
        saving={false}
        onExtractFromResume={onExtract}
        extractingResume={false}
      />
    );

    const fetchBtn = screen.getByRole('button', { name: /Fetch from Master Resume/i });
    fireEvent.click(fetchBtn);

    expect(onExtract).toHaveBeenCalled();
  });

  it('preserves trailing comma and space in draft text when typing keywords', () => {
    const onChange = vi.fn();

    render(
      <ScraperSettingsTab
        config={sampleConfig}
        onChange={onChange}
        onSave={vi.fn()}
        saving={false}
        onExtractFromResume={vi.fn()}
        extractingResume={false}
      />
    );

    const textarea = screen.getByLabelText('Target Role Keywords') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Software Engineer, Backend');

    fireEvent.change(textarea, { target: { value: 'Software Engineer, Backend, ' } });
    expect(textarea.value).toBe('Software Engineer, Backend, ');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        titleFilter: expect.objectContaining({
          positive: ['Software Engineer', 'Backend'],
        }),
      })
    );
  });
});
