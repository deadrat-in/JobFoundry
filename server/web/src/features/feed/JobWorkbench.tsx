import React, { useState, useEffect, useRef } from 'react';
import { Job, JobStatus } from '../../types/job';
import { api } from '../../api/client';
import { getScoreCategory, parseFitNotes } from '../filters/filterUtils';
import { TailorButton } from '../tailor/TailorButton';
import { ArtifactViewer } from '../artifacts/ArtifactViewer';
import { ResumeDiffView } from '../diff/ResumeDiffView';
import { KANBAN_COLUMNS } from '../tracker/trackerUtils';
import {
  ExternalLink,
  Sparkles,
  RefreshCw,
  Trash2,
  MapPin,
  Check,
  X,
  FileText,
  Layers,
  Edit3,
  Save,
} from 'lucide-react';

interface JobWorkbenchProps {
  job: Job | null;
  threshold?: number;
  onStatusChange: (jobId: string, newStatus: JobStatus) => void;
  onJobUpdated: (updatedJob: Job) => void;
  onDeleteJob?: (jobId: string) => void;
}

export const JobWorkbench: React.FC<JobWorkbenchProps> = ({
  job,
  threshold = 75,
  onStatusChange,
  onJobUpdated,
  onDeleteJob,
}) => {
  const currentJobIdRef = useRef<string | undefined>(job?.id);
  currentJobIdRef.current = job?.id;

  const [activeTab, setActiveTab] = useState<'fit' | 'diff' | 'notes'>('fit');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(job?.description || '');
  const [savingDesc, setSavingDesc] = useState(false);
  const [decanting, setDecanting] = useState(false);
  const [sanitizing, setSanitizing] = useState(false);
  const [sanitizeSuccess, setSanitizeSuccess] = useState<string | null>(null);
  const [descError, setDescError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Resume diff states
  const [originalResume, setOriginalResume] = useState<Record<string, any>>({});
  const [tailoredResume, setTailoredResume] = useState<Record<string, any>>({});
  const [loadingDiff, setLoadingDiff] = useState(false);

  // Notes state (stored in localStorage keyed by job.id for persistence)
  const [userNotes, setUserNotes] = useState<string>('');

  useEffect(() => {
    if (job) {
      setDescDraft(job.description || '');
      setEditingDesc(false);
      setDescError(null);
      setSanitizeSuccess(null);
      const savedNotes = localStorage.getItem(`jf_notes_${job.id}`) || '';
      setUserNotes(savedNotes);
      if (activeTab === 'diff' && job.status !== 'tailored' && !job.tailored_resume_id) {
        setActiveTab('fit');
      }
    }
  }, [job?.id]);

  useEffect(() => {
    if (job && (job.status === 'tailored' || job.tailored_resume_id)) {
      setLoadingDiff(true);
      Promise.all([
        api.getActiveResume().catch(() => null),
        api.getTailoredResume(job.id).catch(() => null),
      ])
        .then(([master, tailored]) => {
          if (master?.resume) setOriginalResume(master.resume);
          if (tailored) setTailoredResume(tailored);
        })
        .finally(() => setLoadingDiff(false));
    }
  }, [job?.id, job?.status, job?.tailored_resume_id]);

  const handleSaveNotes = (val: string) => {
    setUserNotes(val);
    if (job) {
      localStorage.setItem(`jf_notes_${job.id}`, val);
    }
  };

  const handleSaveDescription = async () => {
    if (!job) return;
    setSavingDesc(true);
    setDescError(null);
    try {
      const updated = await api.updateJobDescription(job.id, descDraft);
      onJobUpdated(updated);
      setEditingDesc(false);
    } catch (err: any) {
      setDescError(err.message || 'Failed to save description');
    } finally {
      setSavingDesc(false);
    }
  };

  const handleDecantFromUrl = async () => {
    if (!job) return;
    const targetJobId = job.id;
    setDecanting(true);
    setDescError(null);
    try {
      const res = await api.decantJob(targetJobId);
      if (currentJobIdRef.current === targetJobId) {
        if (res.ok && res.description) {
          setDescDraft(res.description);
          onJobUpdated(res.job);
          setEditingDesc(false);
        } else {
          setDescError('Could not extract job description from URL');
        }
      } else if (res.ok && res.job) {
        onJobUpdated(res.job);
      }
    } catch (err: any) {
      if (currentJobIdRef.current === targetJobId) {
        setDescError(err.message || 'Auto-decant failed');
      }
    } finally {
      if (currentJobIdRef.current === targetJobId) {
        setDecanting(false);
      }
    }
  };

  const handleSanitize = async () => {
    if (!job) return;
    const targetJobId = job.id;
    setSanitizing(true);
    setDescError(null);
    setSanitizeSuccess(null);
    try {
      const res = await api.sanitizeJob(targetJobId, { refetch: true });
      if (currentJobIdRef.current === targetJobId) {
        if (res.ok && res.job) {
          onJobUpdated(res.job);
          setDescDraft(res.job.description || '');
          setSanitizeSuccess('Job title, company, and description sanitized with AI!');
          setTimeout(() => {
            if (currentJobIdRef.current === targetJobId) {
              setSanitizeSuccess(null);
            }
          }, 4000);
        }
      } else if (res.ok && res.job) {
        onJobUpdated(res.job);
      }
    } catch (err: any) {
      if (currentJobIdRef.current === targetJobId) {
        setDescError(err.message || 'AI sanitization failed');
      }
    } finally {
      if (currentJobIdRef.current === targetJobId) {
        setSanitizing(false);
      }
    }
  };

  const handleDelete = async () => {
    if (!job || !onDeleteJob) return;
    if (window.confirm(`Permanently remove "${job.title}" at ${job.company}?`)) {
      setDeleting(true);
      try {
        await api.deleteJob(job.id);
        onDeleteJob(job.id);
      } catch (err: any) {
        alert(err.message || 'Failed to delete job');
      } finally {
        setDeleting(false);
      }
    }
  };

  if (!job) {
    return (
      <div className="triage-workbench">
        <div className="triage-empty-workbench">
          <Layers size={40} style={{ opacity: 0.3, marginBottom: '1rem' }} />
          <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
            No Job Selected
          </h3>
          <p style={{ fontSize: '0.875rem', maxWidth: '300px' }}>
            Click any job in the list or press <span className="kbd-pill">J</span> /{' '}
            <span className="kbd-pill">K</span> to triage.
          </p>
        </div>
      </div>
    );
  }

  const fitNotes = parseFitNotes(job.fit_notes);

  const scoreCat = getScoreCategory(job.fit_score, threshold);
  const isTailored = job.status === 'tailored' || Boolean(job.tailored_resume_id);

  return (
    <div className="triage-workbench">
      {/* Header */}
      <div className="triage-workbench-header">
        <div className="triage-workbench-title-area">
          <h2
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              marginBottom: '0.25rem',
              color: 'var(--text-primary)',
            }}
          >
            {job.title}
          </h2>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{job.company}</span>
            {job.location && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                <MapPin size={12} /> {job.location}
              </span>
            )}
            <span className="badge badge-indigo">{job.source}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Ingested {new Date(job.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>

        {/* Top Header Actions */}
        <div className="triage-workbench-actions">
          <select
            value={job.status}
            onChange={(e) => onStatusChange(job.id, e.target.value as JobStatus)}
            className="select-input"
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', fontWeight: 500 }}
            title="Update pipeline status"
          >
            {KANBAN_COLUMNS.map((col) => (
              <option key={col.id} value={col.id}>
                {col.title}
              </option>
            ))}
          </select>

          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              title="Open posting in new tab (press O)"
            >
              <ExternalLink size={13} /> View Post
            </a>
          )}

          <TailorButton job={job} onTailored={onJobUpdated} />

          {onDeleteJob && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="btn btn-secondary btn-sm"
              title="Delete job from database"
              style={{ color: 'var(--color-red)' }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="triage-workbench-tabs">
        <button
          onClick={() => setActiveTab('fit')}
          className={`triage-tab-btn ${activeTab === 'fit' ? 'active' : ''}`}
        >
          <Layers size={14} /> Fit & Description
        </button>
        {isTailored && (
          <button
            onClick={() => setActiveTab('diff')}
            className={`triage-tab-btn ${activeTab === 'diff' ? 'active' : ''}`}
          >
            <FileText size={14} /> Tailored Resume & Diff
          </button>
        )}
        <button
          onClick={() => setActiveTab('notes')}
          className={`triage-tab-btn ${activeTab === 'notes' ? 'active' : ''}`}
        >
          <Edit3 size={14} /> Notes & Prep
        </button>
      </div>

      {/* Body */}
      <div className="triage-workbench-body">
        {sanitizeSuccess && (
          <div
            style={{
              padding: '0.65rem 1rem',
              marginBottom: '1rem',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-green-bg)',
              color: 'var(--color-green)',
              border: '1px solid var(--color-green)',
              fontSize: '0.825rem',
            }}
          >
            {sanitizeSuccess}
          </div>
        )}

        {descError && (
          <div
            style={{
              padding: '0.65rem 1rem',
              marginBottom: '1rem',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-red-bg)',
              color: 'var(--color-red)',
              border: '1px solid var(--color-red)',
              fontSize: '0.825rem',
            }}
          >
            {descError}
          </div>
        )}

        {activeTab === 'fit' && (
          <div>
            {/* Fit Evaluation Box */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '1.25rem',
                marginBottom: '1.5rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '0.75rem',
                }}
              >
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Fit Screener Evaluation
                </h3>
                {job.fit_score !== null && job.fit_score !== undefined ? (
                  <span
                    className={`score-badge score-${scoreCat}`}
                    style={{ fontSize: '0.85rem', padding: '0.2rem 0.6rem' }}
                  >
                    Match: {job.fit_score}%
                  </span>
                ) : (
                  <span className="score-badge score-unscored">Unscored</span>
                )}
              </div>

              {fitNotes.reasoning ? (
                <p
                  style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}
                >
                  {fitNotes.reasoning}
                </p>
              ) : (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  No fit reasoning available yet. Ensure the scorer daemon is running.
                </p>
              )}

              {/* Matching Skills */}
              {fitNotes.matching_skills && fitNotes.matching_skills.length > 0 && (
                <div style={{ marginTop: '0.85rem' }}>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--color-green)',
                      fontWeight: 600,
                      marginBottom: '0.35rem',
                    }}
                  >
                    Matching Skills ({fitNotes.matching_skills.length})
                  </div>
                  <div className="skills-container">
                    {fitNotes.matching_skills.map((s, idx) => (
                      <span
                        key={idx}
                        className="skill-chip skill-matching"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                      >
                        <Check size={11} /> {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Missing Skills */}
              {fitNotes.missing_skills && fitNotes.missing_skills.length > 0 && (
                <div style={{ marginTop: '0.85rem' }}>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--color-amber)',
                      fontWeight: 600,
                      marginBottom: '0.35rem',
                    }}
                  >
                    Gaps / Missing Skills ({fitNotes.missing_skills.length})
                  </div>
                  <div className="skills-container">
                    {fitNotes.missing_skills.map((s, idx) => (
                      <span
                        key={idx}
                        className="skill-chip skill-missing"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                      >
                        <X size={11} /> {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Job Description Section */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '0.65rem',
                }}
              >
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Job Description
                </h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {editingDesc ? (
                    <>
                      <button
                        onClick={handleSaveDescription}
                        disabled={savingDesc}
                        className="btn btn-primary btn-sm"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          fontSize: '0.775rem',
                        }}
                      >
                        <Save size={12} /> {savingDesc ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingDesc(false);
                          setDescDraft(job.description || '');
                        }}
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '0.775rem' }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setEditingDesc(true)}
                        className="btn btn-secondary btn-sm"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          fontSize: '0.775rem',
                        }}
                      >
                        <Edit3 size={12} /> Edit
                      </button>
                      <button
                        onClick={handleDecantFromUrl}
                        disabled={decanting}
                        className="btn btn-secondary btn-sm"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          fontSize: '0.775rem',
                        }}
                        title="Re-fetch and extract full description from posting URL"
                      >
                        <RefreshCw size={12} className={decanting ? 'animate-spin' : ''} />
                        {decanting ? 'Decanting...' : 'Decant URL'}
                      </button>
                      <button
                        onClick={handleSanitize}
                        disabled={sanitizing}
                        className="btn btn-secondary btn-sm"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          fontSize: '0.775rem',
                        }}
                        title="Clean job title, company name, and description with AI"
                      >
                        <Sparkles size={12} />
                        {sanitizing ? 'Sanitizing...' : 'AI Sanitize'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {editingDesc ? (
                <textarea
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  className="input-text"
                  rows={14}
                  style={{
                    width: '100%',
                    fontFamily: 'inherit',
                    fontSize: '0.85rem',
                    lineHeight: 1.6,
                  }}
                />
              ) : (
                <div
                  style={{
                    background: 'rgba(0,0,0,0.25)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1.25rem',
                    fontSize: '0.85rem',
                    lineHeight: 1.65,
                    color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap',
                    maxHeight: '480px',
                    overflowY: 'auto',
                  }}
                >
                  {job.description || (
                    <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      No full description stored. Click "Decant URL" above to extract from web page.
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'diff' && (
          <div>
            {loadingDiff ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Loading tailored resume diff...
              </div>
            ) : (
              <div>
                <ResumeDiffView originalResume={originalResume} tailoredResume={tailoredResume} />
                <div style={{ marginTop: '1.5rem' }}>
                  <ArtifactViewer jobId={job.id} job={job} />
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'notes' && (
          <div>
            <div style={{ marginBottom: '1rem' }}>
              <h3
                style={{
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  marginBottom: '0.35rem',
                }}
              >
                Interview & Application Notes
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Jot down recruiter names, interview discussion questions, salary notes, or follow-up
                tasks. Persisted locally.
              </p>
            </div>
            <textarea
              value={userNotes}
              onChange={(e) => handleSaveNotes(e.target.value)}
              placeholder="e.g. Recruiter Sarah reached out via LinkedIn. First round technical screening on Tuesday at 2 PM..."
              className="input-text"
              rows={12}
              style={{
                width: '100%',
                fontFamily: 'inherit',
                fontSize: '0.85rem',
                lineHeight: 1.6,
                background: 'rgba(0,0,0,0.25)',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
