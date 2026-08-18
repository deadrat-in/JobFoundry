import React from 'react';
import { Job, FitNotes } from '../../types/job';
import { getScoreCategory } from '../filters/filterUtils';
import { TailorButton } from '../tailor/TailorButton';

interface JobCardProps {
  job: Job;
  threshold?: number;
  onSelect: (job: Job) => void;
  onTailored?: (updatedJob: Job) => void;
}

export const JobCard: React.FC<JobCardProps> = ({ job, threshold = 75, onSelect, onTailored }) => {
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
    <div className="job-card" onClick={() => onSelect(job)}>
      <div>
        <div className="job-card-header">
          <div>
            <h3 className="job-card-title">{job.title}</h3>
            <div className="job-card-company">{job.company}</div>
          </div>
          {job.fit_score !== null && job.fit_score !== undefined ? (
            <span className={`score-badge score-${scoreCat}`}>{job.fit_score}%</span>
          ) : (
            <span className="score-badge score-unscored">Unscored</span>
          )}
        </div>

        <div className="job-card-meta">
          {job.location && <span className="meta-item">📍 {job.location}</span>}
          <span className="badge badge-indigo">{job.source}</span>
          <span
            className={`badge ${job.status === 'tailored' ? 'badge-purple' : job.status === 'rejected_by_score' ? 'badge-red' : 'badge-blue'}`}
          >
            {job.status.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Skills Chips Snippet */}
        {fitNotes.matching_skills && fitNotes.matching_skills.length > 0 && (
          <div className="skills-container">
            {fitNotes.matching_skills.slice(0, 3).map((s, idx) => (
              <span key={idx} className="skill-chip skill-matching">
                ✓ {s}
              </span>
            ))}
            {fitNotes.matching_skills.length > 3 && (
              <span
                className="skill-chip"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}
              >
                +{fitNotes.matching_skills.length - 3} more
              </span>
            )}
          </div>
        )}

        {fitNotes.reasoning && (
          <p
            style={{
              fontSize: '0.825rem',
              color: 'var(--text-secondary)',
              marginTop: '0.5rem',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {fitNotes.reasoning}
          </p>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '1.25rem',
          paddingTop: '0.75rem',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {new Date(job.created_at).toLocaleDateString()}
        </span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <TailorButton job={job} onTailored={onTailored} />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect(job);
            }}
            className="btn btn-secondary btn-sm"
          >
            Details →
          </button>
        </div>
      </div>
    </div>
  );
};
