import React from 'react';
import { Job, JobStatus } from '../../types/job';
import { KANBAN_COLUMNS, isMoveAllowed } from './trackerUtils';
import { getScoreCategory } from '../filters/filterUtils';

interface KanbanBoardProps {
  jobs: Job[];
  threshold?: number;
  onSelectJob: (job: Job) => void;
  onStatusChange: (jobId: string, newStatus: JobStatus) => void;
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  jobs,
  threshold = 75,
  onSelectJob,
  onStatusChange,
}) => {
  const handleDragStart = (e: React.DragEvent, jobId: string) => {
    e.dataTransfer.setData('text/plain', jobId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetStatus: JobStatus) => {
    e.preventDefault();
    const jobId = e.dataTransfer.getData('text/plain');
    if (!jobId) return;

    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;

    if (isMoveAllowed(job.status, targetStatus)) {
      onStatusChange(jobId, targetStatus);
    }
  };

  return (
    <div className="kanban-board">
      {KANBAN_COLUMNS.map((column) => {
        const columnJobs = jobs.filter((j) => {
          if (column.id === 'rejected') {
            return j.status === 'rejected' || j.status === 'rejected_by_score';
          }
          return j.status === column.id;
        });

        return (
          <div
            key={column.id}
            className="kanban-column"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, column.id)}
          >
            <div className="kanban-column-header">
              <div className="kanban-column-title">
                <span className={`badge ${column.badgeClass}`}>{column.title}</span>
              </div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                {columnJobs.length}
              </span>
            </div>

            <div className="kanban-cards-list">
              {columnJobs.map((job) => {
                const scoreCat = getScoreCategory(job.fit_score, threshold);
                return (
                  <div
                    key={job.id}
                    className="kanban-card"
                    draggable
                    onDragStart={(e) => handleDragStart(e, job.id)}
                    onClick={() => onSelectJob(job)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.35rem' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', lineHeight: 1.3 }}>
                        {job.title}
                      </div>
                      {job.fit_score !== null && job.fit_score !== undefined && (
                        <span className={`score-badge score-${scoreCat}`} style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem' }}>
                          {job.fit_score}%
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.775rem', color: 'var(--text-secondary)' }}>
                      {job.company}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
