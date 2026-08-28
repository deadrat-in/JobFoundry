import React, { useState } from 'react';
import { api } from '../../api/client';
import { Job } from '../../types/job';

interface AddJobModalProps {
  onClose: () => void;
  onJobAdded: (job: Job) => void;
}

export const AddJobModal: React.FC<AddJobModalProps> = ({ onClose, onJobAdded }) => {
  const [tab, setTab] = useState<'paste' | 'manual'>('paste');

  // Input states for AI Parser tab
  const [pasteText, setPasteText] = useState('');
  const [pasteUrl, setPasteUrl] = useState('');
  const [parsing, setParsing] = useState(false);

  // Form states (populated by parser or filled manually)
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [url, setUrl] = useState('');
  const [source, setSource] = useState('manual');
  const [description, setDescription] = useState('');
  const [salary, setSalary] = useState('');
  const [requirements, setRequirements] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleAutoParse = async () => {
    if (!pasteText.trim() || pasteText.trim().length < 15) {
      setError('Please paste a job description (at least 15 characters).');
      return;
    }

    setParsing(true);
    setError(null);
    try {
      const res = await api.parseJd({
        text: pasteText,
        url: pasteUrl.trim() || undefined,
      });

      if (res.ok && res.job) {
        setTitle(res.job.title || '');
        setCompany(res.job.company || '');
        setLocation(res.job.location || '');
        setUrl(pasteUrl.trim() || res.job.url || `https://manual-job.local/${Date.now()}`);
        setDescription(res.job.description || pasteText);
        setSalary(res.job.salary || '');
        setRequirements(res.job.requirements || []);
        setSource(pasteUrl ? 'web' : 'manual');
        setTab('manual'); // Switch to manual tab to inspect and finalize
        setSuccessMsg('✨ Job parsed successfully! Review the fields below and save.');
      } else {
        setError('Could not extract structured data. Please fill in the fields manually.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to parse job description with AI.');
    } finally {
      setParsing(false);
    }
  };

  const handleSaveJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Job Title is required.');
      return;
    }
    if (!company.trim()) {
      setError('Company Name is required.');
      return;
    }

    const jobUrl = url.trim() || `https://manual-job.local/${Date.now()}`;
    const desc = description.trim() || pasteText.trim() || 'No description provided.';

    setSaving(true);
    setError(null);

    try {
      const payload: Partial<Job> = {
        title: title.trim(),
        company: company.trim(),
        location: location.trim() || null,
        url: jobUrl,
        source: source.trim() || 'manual',
        description: desc,
      };

      const res = await api.ingestJobs(payload);
      if (res && res.ids && res.ids.length > 0) {
        const createdJobId = res.ids[0];
        // Fetch the fresh job record
        try {
          const freshJob = await api.getJob(createdJobId);
          onJobAdded(freshJob);
        } catch {
          // Fallback constructed job if getJob fails
          onJobAdded({
            id: createdJobId,
            title: title.trim(),
            company: company.trim(),
            location: location.trim() || null,
            url: jobUrl,
            source: source.trim() || 'manual',
            description: desc,
            status: 'new',
            liveness: 'unknown',
            created_at: Date.now(),
            updated_at: Date.now(),
          });
        }
        onClose();
      } else {
        setError('Server did not return a job ID after ingestion.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to save and ingest job.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.5rem' }}>➕</span>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Add Job to Pipeline
              </h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Paste raw JD text/markdown for AI parsing or enter details manually.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '1.25rem',
              cursor: 'pointer',
              padding: '0.25rem',
            }}
          >
            ✕
          </button>
        </div>

        {/* Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'rgba(0, 0, 0, 0.2)',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setTab('paste');
              setError(null);
            }}
            style={{
              flex: 1,
              padding: '0.75rem',
              background: 'transparent',
              border: 'none',
              borderBottom:
                tab === 'paste' ? '2px solid var(--accent-primary)' : '2px solid transparent',
              color: tab === 'paste' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: tab === 'paste' ? 600 : 400,
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            ⚡ Paste JD & Auto-Parse (AI)
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('manual');
              setError(null);
            }}
            style={{
              flex: 1,
              padding: '0.75rem',
              background: 'transparent',
              border: 'none',
              borderBottom:
                tab === 'manual' ? '2px solid var(--accent-primary)' : '2px solid transparent',
              color: tab === 'manual' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: tab === 'manual' ? 600 : 400,
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            ✏️ Job Details & Review
          </button>
        </div>

        {/* Modal Body */}
        <div
          style={{
            padding: '1.5rem',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {error && (
            <div
              style={{
                padding: '0.75rem 1rem',
                marginBottom: '1rem',
                backgroundColor: 'var(--color-red-bg)',
                border: '1px solid var(--color-red)',
                borderRadius: 'var(--radius-sm)',
                color: '#fca5a5',
                fontSize: '0.85rem',
              }}
            >
              ⚠️ {error}
            </div>
          )}

          {successMsg && (
            <div
              style={{
                padding: '0.75rem 1rem',
                marginBottom: '1rem',
                backgroundColor: 'var(--color-green-bg)',
                border: '1px solid var(--color-green)',
                borderRadius: 'var(--radius-sm)',
                color: '#6ee7b7',
                fontSize: '0.85rem',
              }}
            >
              {successMsg}
            </div>
          )}

          {tab === 'paste' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    marginBottom: '0.35rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Job Posting URL (Optional)
                </label>
                <input
                  type="url"
                  placeholder="https://jobs.example.com/posting/123"
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '0.9rem',
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    marginBottom: '0.35rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Job Description Text or Markdown *
                </label>
                <textarea
                  rows={9}
                  placeholder="Paste the full job description, requirements, or web page text here..."
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    lineHeight: '1.5',
                    fontFamily: 'monospace',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.75rem',
                  marginTop: '0.5rem',
                }}
              >
                <button
                  type="button"
                  onClick={handleAutoParse}
                  disabled={parsing || !pasteText.trim()}
                  style={{
                    padding: '0.65rem 1.25rem',
                    background: 'var(--accent-gradient)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    cursor: parsing || !pasteText.trim() ? 'not-allowed' : 'pointer',
                    opacity: parsing || !pasteText.trim() ? 0.6 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {parsing ? '⏳ Parsing with AI...' : '✨ Auto-Parse with AI'}
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={handleSaveJob}
              style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      marginBottom: '0.35rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Job Title *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Senior Machine Learning Engineer"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      marginBottom: '0.35rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Company Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. OpenAI"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      marginBottom: '0.35rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Location / Remote
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. San Francisco, CA (Remote)"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      marginBottom: '0.35rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Salary / Compensation
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. $180,000 - $220,000"
                    value={salary}
                    onChange={(e) => setSalary(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      marginBottom: '0.35rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Source URL
                  </label>
                  <input
                    type="text"
                    placeholder="https://..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      marginBottom: '0.35rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Source Tag
                  </label>
                  <input
                    type="text"
                    placeholder="manual / linkedin / etc."
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>
              </div>

              {requirements.length > 0 && (
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      marginBottom: '0.35rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Extracted Requirements ({requirements.length})
                  </label>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.4rem',
                      padding: '0.5rem',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      maxHeight: '100px',
                      overflowY: 'auto',
                    }}
                  >
                    {requirements.map((req, idx) => (
                      <span
                        key={idx}
                        style={{
                          fontSize: '0.75rem',
                          background: 'rgba(99, 102, 241, 0.15)',
                          color: '#a5b4fc',
                          padding: '0.2rem 0.5rem',
                          borderRadius: 'var(--radius-sm)',
                        }}
                      >
                        {req}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    marginBottom: '0.35rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Job Description (Markdown)
                </label>
                <textarea
                  rows={6}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.8rem',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    lineHeight: '1.4',
                    fontFamily: 'monospace',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.75rem',
                  marginTop: '0.5rem',
                }}
              >
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '0.6rem 1.25rem',
                    background: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-secondary)',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: '0.6rem 1.25rem',
                    background: 'var(--accent-primary)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? 'Saving...' : '💾 Save & Ingest'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
