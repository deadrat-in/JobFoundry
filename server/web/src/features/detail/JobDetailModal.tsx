import React, { useState, useEffect } from 'react';
import { Job, FitNotes, JobStatus } from '../../types/job';
import { api } from '../../api/client';
import { getScoreCategory } from '../filters/filterUtils';
import { TailorButton } from '../tailor/TailorButton';
import { ArtifactViewer } from '../artifacts/ArtifactViewer';
import { ResumeDiffView } from '../diff/ResumeDiffView';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { KANBAN_COLUMNS } from '../tracker/trackerUtils';

interface JobDetailModalProps {
  job: Job | null;
  threshold?: number;
  onClose: () => void;
  onStatusChange: (jobId: string, newStatus: JobStatus) => void;
  onJobUpdated: (updatedJob: Job) => void;
  onDeleteJob?: (jobId: string) => void;
}

export const JobDetailModal: React.FC<JobDetailModalProps> = ({
  job,
  threshold = 75,
  onClose,
  onStatusChange,
  onJobUpdated,
  onDeleteJob,
}) => {
  const [activeTab, setActiveTab] = useState<'details' | 'diff'>('details');
  const [deleting, setDeleting] = useState(false);
  const [originalResume, setOriginalResume] = useState<Record<string, any>>({});
  const [tailoredResume, setTailoredResume] = useState<Record<string, any>>({});
  const [loadingDiff, setLoadingDiff] = useState(false);

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

  if (!job) return null;

  let fitNotes: FitNotes = {};
  if (job.fit_notes) {
    try {
      fitNotes = JSON.parse(job.fit_notes);
    } catch {
      fitNotes = { reasoning: job.fit_notes };
    }
  }

  const scoreCat = getScoreCategory(job.fit_score, threshold);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <ErrorBoundary fallbackTitle="Job Details Rendering Error">
          {/* Header */}
          <div className="modal-header">
            <div>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>{job.title}</h2>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  fontSize: '0.875rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>{job.company}</span>
                {job.location && <span>• {job.location}</span>}
                <span className="badge badge-indigo">{job.source}</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="btn btn-secondary btn-sm"
              style={{
                borderRadius: 'var(--radius-full)',
                width: '32px',
                height: '32px',
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>

          {/* Subheader / Tabs */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.75rem 1.5rem',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => setActiveTab('details')}
                className={`btn btn-sm ${activeTab === 'details' ? 'btn-primary' : 'btn-secondary'}`}
              >
                Job & Fit Details
              </button>
              {(job.status === 'tailored' || job.tailored_resume_id) && (
                <button
                  onClick={() => setActiveTab('diff')}
                  className={`btn btn-sm ${activeTab === 'diff' ? 'btn-primary' : 'btn-secondary'}`}
                >
                  Resume Diff
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Status:</label>
              <select
                value={job.status}
                onChange={(e) => onStatusChange(job.id, e.target.value as JobStatus)}
                className="select-input"
                style={{ padding: '0.35rem 0.65rem' }}
              >
                {KANBAN_COLUMNS.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.title}
                  </option>
                ))}
              </select>
              <TailorButton job={job} onTailored={onJobUpdated} />
            </div>
          </div>

          {/* Body */}
          <div className="modal-body">
            {activeTab === 'diff' ? (
              loadingDiff ? (
                <div
                  style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}
                >
                  Loading tailored resume diff...
                </div>
              ) : (
                <ResumeDiffView originalResume={originalResume} tailoredResume={tailoredResume} />
              )
            ) : (
              <div>
                {/* Fit Screener Evaluation Box */}
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
                    <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>
                      Fit Screener Evaluation
                    </h3>
                    {job.fit_score !== null && job.fit_score !== undefined ? (
                      <span
                        className={`score-badge score-${scoreCat}`}
                        style={{ fontSize: '1rem', padding: '0.4rem 0.8rem' }}
                      >
                        {job.fit_score} / 100
                      </span>
                    ) : (
                      <span className="score-badge score-unscored">Unscored</span>
                    )}
                  </div>

                  {fitNotes.reasoning && (
                    <p
                      style={{
                        fontSize: '0.9rem',
                        color: 'var(--text-secondary)',
                        marginBottom: '0.75rem',
                        lineHeight: 1.5,
                      }}
                    >
                      {fitNotes.reasoning}
                    </p>
                  )}

                  {fitNotes.matching_skills && fitNotes.matching_skills.length > 0 && (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: 'var(--color-green)',
                        }}
                      >
                        Matching Skills:{' '}
                      </span>
                      <div className="skills-container" style={{ margin: '0.25rem 0' }}>
                        {fitNotes.matching_skills.map((skill, idx) => (
                          <span key={idx} className="skill-chip skill-matching">
                            ✓ {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {fitNotes.missing_skills && fitNotes.missing_skills.length > 0 && (
                    <div>
                      <span
                        style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-red)' }}
                      >
                        Missing Skills:{' '}
                      </span>
                      <div className="skills-container" style={{ margin: '0.25rem 0' }}>
                        {fitNotes.missing_skills.map((skill, idx) => (
                          <span key={idx} className="skill-chip skill-missing">
                            ✗ {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Artifacts section if tailored */}
                {job.status === 'tailored' && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <ArtifactViewer jobId={job.id} />
                  </div>
                )}

                {/* Job Description */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.75rem',
                    }}
                  >
                    <h3 style={{ fontSize: '1rem' }}>Job Description</h3>
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: '0.75rem' }}
                    >
                      View Original Posting ↗
                    </a>
                  </div>
                  <div
                    style={{
                      background: 'rgba(0, 0, 0, 0.25)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: '1.25rem',
                      fontSize: '0.875rem',
                      lineHeight: 1.6,
                      color: 'var(--text-secondary)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {job.description || 'No description provided.'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="modal-footer"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            {onDeleteJob ? (
              <button
                onClick={async () => {
                  if (
                    window.confirm(`Delete "${job.title}" at ${job.company} from the database?`)
                  ) {
                    setDeleting(true);
                    try {
                      await api.deleteJob(job.id);
                      onDeleteJob(job.id);
                      onClose();
                    } catch (err: any) {
                      alert(`Failed to delete job: ${err.message}`);
                    } finally {
                      setDeleting(false);
                    }
                  }
                }}
                disabled={deleting}
                className="btn btn-secondary btn-sm"
                style={{
                  color: 'var(--color-red, #ef4444)',
                  borderColor: 'rgba(239, 68, 68, 0.3)',
                }}
              >
                {deleting ? 'Deleting...' : '🗑️ Delete from DB'}
              </button>
            ) : (
              <div />
            )}
            <button onClick={onClose} className="btn btn-secondary btn-sm">
              Close
            </button>
          </div>
        </ErrorBoundary>
      </div>
    </div>
  );
};
