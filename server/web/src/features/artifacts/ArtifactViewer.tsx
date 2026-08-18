import React, { useState } from 'react';
import { api } from '../../api/client';

interface ArtifactViewerProps {
  jobId: string;
}

export const ArtifactViewer: React.FC<ArtifactViewerProps> = ({ jobId }) => {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDownloadPdf = async (theme: 'folio' | 'concise') => {
    setDownloading(theme);
    setError(null);
    try {
      const blob = await api.downloadPdf(jobId, theme);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = theme === 'concise' ? `resume-concise-${jobId}.pdf` : `resume-${jobId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Failed to download PDF');
    } finally {
      setDownloading(null);
    }
  };

  const handlePreviewPdf = async (theme: 'folio' | 'concise') => {
    setDownloading(`preview-${theme}`);
    setError(null);
    try {
      const blob = await api.downloadPdf(jobId, theme);
      const url = window.URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (err: any) {
      setError(err.message || 'Failed to load PDF preview');
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadAts = async () => {
    setDownloading('ats');
    setError(null);
    try {
      const text = await api.downloadAts(jobId);
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `resume-${jobId}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Failed to download ATS text');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div style={{ marginTop: '1rem' }}>
      <h4 style={{ marginBottom: '0.75rem', fontSize: '0.95rem' }}>
        Tailored Documents & Artifacts
      </h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <button
          onClick={() => handleDownloadPdf('folio')}
          disabled={Boolean(downloading)}
          className="btn btn-secondary btn-sm"
        >
          {downloading === 'folio' ? 'Downloading...' : 'Standard PDF'}
        </button>

        <button
          onClick={() => handleDownloadPdf('concise')}
          disabled={Boolean(downloading)}
          className="btn btn-secondary btn-sm"
        >
          {downloading === 'concise' ? 'Downloading...' : 'Concise PDF'}
        </button>

        <button
          onClick={() => handlePreviewPdf('folio')}
          disabled={Boolean(downloading)}
          className="btn btn-secondary btn-sm"
        >
          {downloading === 'preview-folio' ? 'Loading...' : 'Preview PDF'}
        </button>

        <button
          onClick={handleDownloadAts}
          disabled={Boolean(downloading)}
          className="btn btn-secondary btn-sm"
        >
          {downloading === 'ats' ? 'Downloading...' : 'ATS Text (.txt)'}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: '0.8rem', color: 'var(--color-red)', marginBottom: '0.5rem' }}>
          {error}
        </div>
      )}

      {previewUrl && (
        <div
          style={{
            marginTop: '1rem',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '0.5rem 1rem',
              background: 'rgba(0,0,0,0.3)',
            }}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>PDF Live Preview</span>
            <button
              onClick={() => {
                window.URL.revokeObjectURL(previewUrl);
                setPreviewUrl(null);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
          <iframe
            src={previewUrl}
            style={{ width: '100%', height: '450px', border: 'none' }}
            title="PDF Preview"
          />
        </div>
      )}
    </div>
  );
};
