import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArtifactViewer, buildDownloadFilename } from '../ArtifactViewer';
import { api } from '../../../api/client';
import { Job } from '../../../types/job';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Jane Doe', email: 'jane@example.com' },
    token: 'test-token',
  }),
}));

const mockJob: Job = {
  id: 'job-123',
  title: 'Senior / Staff Platform Engineer',
  company: 'Stripe, Inc.',
  location: 'Remote',
  url: 'https://stripe.com/jobs/123',
  source: 'greenhouse',
  liveness: 'active',
  status: 'tailored',
  created_at: Date.now(),
  updated_at: Date.now(),
};

describe('ArtifactViewer & buildDownloadFilename', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildDownloadFilename', () => {
    it('creates a sanitized filename formatted as Name_Surname-Company-Job_Title.ext', () => {
      const filename = buildDownloadFilename(
        'Jane Doe',
        'Stripe, Inc.',
        'Senior / Staff Platform Engineer',
        undefined,
        'pdf'
      );
      // Slashes sanitized, hyphens between segments, spaces to underscores within segments
      expect(filename).toBe('Jane_Doe-Stripe,_Inc.-Senior_Staff_Platform_Engineer.pdf');
    });

    it('handles variants like Concise and ATS text', () => {
      const conciseName = buildDownloadFilename('Jane Doe', 'Google', 'SRE', 'Concise', 'pdf');
      expect(conciseName).toBe('Jane_Doe-Google-SRE-Concise.pdf');

      const atsName = buildDownloadFilename('Jane Doe', 'Google', 'SRE', 'ATS', 'txt');
      expect(atsName).toBe('Jane_Doe-Google-SRE-ATS.txt');

      const jsonName = buildDownloadFilename('Jane Doe', 'Google', 'SRE', undefined, 'json');
      expect(jsonName).toBe('Jane_Doe-Google-SRE.json');
    });

    it('falls back gracefully when fields are missing', () => {
      const fallback = buildDownloadFilename(null, null, null, undefined, 'pdf');
      expect(fallback).toBe('Resume.pdf');
    });
  });

  describe('ArtifactViewer Component', () => {
    it('renders all download and preview options including JSON and ATS', () => {
      render(<ArtifactViewer jobId="job-123" job={mockJob} />);

      expect(screen.getByText('Standard PDF')).toBeInTheDocument();
      expect(screen.getByText('Concise PDF')).toBeInTheDocument();
      expect(screen.getByText('ATS Text (.txt)')).toBeInTheDocument();
      expect(screen.getByText('Resume JSON (.json)')).toBeInTheDocument();
      expect(screen.getByText('Preview Standard')).toBeInTheDocument();
      expect(screen.getByText('Preview Concise')).toBeInTheDocument();
    });

    it('downloads JSON resume with human-readable filename', async () => {
      const mockResumeData = {
        basics: { name: 'Jane Doe', label: 'Engineer' },
        work: [],
      };
      vi.spyOn(api, 'getTailoredResume').mockResolvedValue(mockResumeData);

      const appendChildSpy = vi.spyOn(document.body, 'appendChild');
      const removeChildSpy = vi.spyOn(document.body, 'removeChild');

      render(<ArtifactViewer jobId="job-123" job={mockJob} />);

      const jsonBtn = screen.getByText('Resume JSON (.json)');
      fireEvent.click(jsonBtn);

      await waitFor(() => {
        expect(api.getTailoredResume).toHaveBeenCalledWith('job-123');
        expect(appendChildSpy).toHaveBeenCalled();
        expect(removeChildSpy).toHaveBeenCalled();
      });
    });

    it('downloads PDF with human-readable filename', async () => {
      const mockBlob = new Blob(['%PDF-1.4 mock content'], { type: 'application/pdf' });
      vi.spyOn(api, 'downloadPdf').mockResolvedValue(mockBlob);

      const appendChildSpy = vi.spyOn(document.body, 'appendChild');
      const removeChildSpy = vi.spyOn(document.body, 'removeChild');

      render(<ArtifactViewer jobId="job-123" job={mockJob} />);

      const pdfBtn = screen.getByText('Standard PDF');
      fireEvent.click(pdfBtn);

      await waitFor(() => {
        expect(api.downloadPdf).toHaveBeenCalledWith('job-123', 'folio');
        expect(appendChildSpy).toHaveBeenCalled();
        expect(removeChildSpy).toHaveBeenCalled();
      });
    });
  });
});
