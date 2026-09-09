import React, { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { Job } from '../../types/job';
import { useAuth } from '../../context/AuthContext';
import { Download, Eye, FileText, FileCode, AlignLeft, X } from 'lucide-react';

interface ArtifactViewerProps {
  jobId: string;
  job?: Job | null;
}

export function buildDownloadFilename(
  name?: string | null,
  company?: string | null,
  title?: string | null,
  variant?: string,
  extension: string = 'pdf'
): string {
  const sanitize = (str: string) =>
    str
      .trim()
      .replace(/[\/\\?%*:|"<>]/g, '') // remove illegal characters
      .replace(/\s+/g, '_'); // replace spaces with underscores

  const parts: string[] = [];
  if (name) parts.push(sanitize(name));
  if (company) parts.push(sanitize(company));
  if (title) parts.push(sanitize(title));
  if (variant) parts.push(sanitize(variant));

  const base = parts.filter(Boolean).join('-');
  return `${base || 'Resume'}.${extension}`;
}

export const ArtifactViewer: React.FC<ArtifactViewerProps> = ({ jobId, job }) => {
  const { user } = useAuth();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTheme, setPreviewTheme] = useState<'folio' | 'concise'>('folio');
  const [candidateName, setCandidateName] = useState<string>(user?.name || '');
  const [error, setError] = useState<string | null>(null);

  // Fetch tailored resume data to resolve candidate name if not yet set
  useEffect(() => {
    if (!candidateName) {
      api
        .getTailoredResume(jobId)
        .then((tailored) => {
          if (tailored?.basics?.name) {
            setCandidateName(tailored.basics.name);
          }
        })
        .catch(() => {});
    }
  }, [jobId, candidateName]);

  const handleDownloadPdf = async (theme: 'folio' | 'concise') => {
    setDownloading(theme);
    setError(null);
    try {
      const blob = await api.downloadPdf(jobId, theme);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildDownloadFilename(
        candidateName,
        job?.company,
        job?.title,
        theme === 'concise' ? 'Concise' : undefined,
        'pdf'
      );
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
      if (previewUrl) {
        window.URL.revokeObjectURL(previewUrl);
      }
      const url = window.URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewTheme(theme);
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
      a.download = buildDownloadFilename(candidateName, job?.company, job?.title, 'ATS', 'txt');
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

  const handleDownloadJson = async () => {
    setDownloading('json');
    setError(null);
    try {
      const data = await api.getTailoredResume(jobId);
      if (!data) {
        throw new Error('No tailored resume JSON available');
      }
      const jsonText = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildDownloadFilename(
        candidateName,
        job?.company,
        job?.title,
        undefined,
        'json'
      );
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Failed to download resume JSON');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div style={{ marginTop: '1rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.75rem',
        }}
      >
        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Tailored Documents & Export
        </h4>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Generated in Folio, ATS Text & JSON formats
        </span>
      </div>

      {/* Download Action Buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <button
          onClick={() => handleDownloadPdf('folio')}
          disabled={Boolean(downloading)}
          className="btn btn-secondary btn-sm"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          title="Download full standard PDF formatted with Folio theme"
        >
          <FileText size={13} />
          {downloading === 'folio' ? 'Downloading...' : 'Standard PDF'}
        </button>

        <button
          onClick={() => handleDownloadPdf('concise')}
          disabled={Boolean(downloading)}
          className="btn btn-secondary btn-sm"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          title="Download single-page concise PDF"
        >
          <Download size={13} />
          {downloading === 'concise' ? 'Downloading...' : 'Concise PDF'}
        </button>

        <button
          onClick={handleDownloadAts}
          disabled={Boolean(downloading)}
          className="btn btn-secondary btn-sm"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          title="Download ATS plain text resume (.txt)"
        >
          <AlignLeft size={13} />
          {downloading === 'ats' ? 'Downloading...' : 'ATS Text (.txt)'}
        </button>

        <button
          onClick={handleDownloadJson}
          disabled={Boolean(downloading)}
          className="btn btn-secondary btn-sm"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          title="Download tailored JSONResume data (.json)"
        >
          <FileCode size={13} />
          {downloading === 'json' ? 'Downloading...' : 'Resume JSON (.json)'}
        </button>

        <button
          onClick={() => handlePreviewPdf('folio')}
          disabled={Boolean(downloading)}
          className={`btn btn-secondary btn-sm ${previewUrl && previewTheme === 'folio' ? 'btn-primary' : ''}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          title="Live preview Standard PDF in browser"
        >
          <Eye size={13} />
          {downloading === 'preview-folio' ? 'Loading...' : 'Preview Standard'}
        </button>

        <button
          onClick={() => handlePreviewPdf('concise')}
          disabled={Boolean(downloading)}
          className={`btn btn-secondary btn-sm ${previewUrl && previewTheme === 'concise' ? 'btn-primary' : ''}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          title="Live preview Concise PDF in browser"
        >
          <Eye size={13} />
          {downloading === 'preview-concise' ? 'Loading...' : 'Preview Concise'}
        </button>
      </div>

      {error && (
        <div
          style={{
            fontSize: '0.8rem',
            color: 'var(--color-red)',
            marginBottom: '0.5rem',
            background: 'var(--color-red-bg)',
            padding: '0.4rem 0.65rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-red)',
          }}
        >
          {error}
        </div>
      )}

      {/* PDF Live Preview Box */}
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
              alignItems: 'center',
              padding: '0.5rem 1rem',
              background: 'rgba(0,0,0,0.3)',
            }}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              Live Preview: {previewTheme === 'concise' ? 'Concise Theme' : 'Standard Folio Theme'}
            </span>
            <button
              onClick={() => {
                if (previewUrl) window.URL.revokeObjectURL(previewUrl);
                setPreviewUrl(null);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
              title="Close preview"
            >
              <X size={15} />
            </button>
          </div>
          <iframe
            src={previewUrl}
            style={{ width: '100%', height: '520px', border: 'none' }}
            title="PDF Preview"
          />
        </div>
      )}
    </div>
  );
};
