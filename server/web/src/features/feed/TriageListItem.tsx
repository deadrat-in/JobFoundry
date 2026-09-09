import React from 'react';
import { Job } from '../../types/job';
import { getScoreCategory, parseFitNotes } from '../filters/filterUtils';
import { MapPin } from 'lucide-react';

interface TriageListItemProps {
  job: Job;
  threshold?: number;
  isActive: boolean;
  onSelect: () => void;
}

export const TriageListItem: React.FC<TriageListItemProps> = ({
  job,
  threshold = 75,
  isActive,
  onSelect,
}) => {
  const fitNotes = parseFitNotes(job.fit_notes);
  const scoreCat = getScoreCategory(job.fit_score, threshold);

  return (
    <div
      className={`triage-item ${isActive ? 'active' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-current={isActive ? 'true' : undefined}
    >
      <div className="triage-item-row-top">
        <span className="triage-item-title" title={job.title}>
          {job.title}
        </span>
        {job.fit_score !== null && job.fit_score !== undefined ? (
          <span
            className={`score-badge score-${scoreCat}`}
            style={{ fontSize: '0.725rem', padding: '0.15rem 0.45rem' }}
          >
            {job.fit_score}%
          </span>
        ) : (
          <span
            className="score-badge score-unscored"
            style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
          >
            —
          </span>
        )}
      </div>

      <div className="triage-item-company" title={job.company}>
        {job.company}
      </div>

      <div className="triage-item-meta">
        <div className="triage-item-tags">
          <span
            className="badge badge-indigo"
            style={{ fontSize: '0.675rem', padding: '0.1rem 0.4rem' }}
          >
            {job.source}
          </span>
          <span
            className={`badge ${
              job.status === 'tailored'
                ? 'badge-purple'
                : job.status === 'rejected_by_score' || job.status === 'rejected'
                  ? 'badge-red'
                  : job.status === 'archived'
                    ? 'badge-muted'
                    : job.status === 'applied' ||
                        job.status === 'interview' ||
                        job.status === 'offer'
                      ? 'badge-green'
                      : 'badge-blue'
            }`}
            style={{ fontSize: '0.675rem', padding: '0.1rem 0.4rem' }}
          >
            {job.status.replace(/_/g, ' ')}
          </span>
          {job.location && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.15rem',
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
                maxWidth: '120px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <MapPin size={10} /> {job.location}
            </span>
          )}
          {fitNotes.matching_skills && fitNotes.matching_skills.length > 0 && (
            <span style={{ fontSize: '0.675rem', color: 'var(--color-green)', fontWeight: 500 }}>
              {fitNotes.matching_skills.length} matches
            </span>
          )}
        </div>

        <span style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>
          {new Date(job.created_at).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </div>
    </div>
  );
};
