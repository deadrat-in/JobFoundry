import React, { useState, useMemo } from 'react';
import { Job } from '../../types/job';
import { JobCard } from './JobCard';
import { filterJobs, FilterCriteria } from '../filters/filterUtils';

interface JobFeedProps {
  jobs: Job[];
  threshold?: number;
  onSelectJob: (job: Job) => void;
  onJobUpdated?: (updatedJob: Job) => void;
}

export const JobFeed: React.FC<JobFeedProps> = ({
  jobs,
  threshold = 75,
  onSelectJob,
  onJobUpdated,
}) => {
  const [filters, setFilters] = useState<FilterCriteria>({
    search: '',
    status: 'all',
    source: 'all',
    minScore: undefined,
  });

  const availableSources = useMemo(() => {
    return Array.from(new Set(jobs.map((j) => j.source))).filter(Boolean);
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    return filterJobs(jobs, filters);
  }, [jobs, filters]);

  return (
    <div>
      {/* Filters Bar */}
      <div className="filters-bar">
        <div className="search-input-wrapper">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search title, company, skills..."
            value={filters.search || ''}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            className="input-text"
          />
        </div>

        <select
          value={filters.status || 'all'}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          className="select-input"
        >
          <option value="all">All Statuses</option>
          <option value="new">New</option>
          <option value="tailored">Tailored</option>
          <option value="saved">Saved</option>
          <option value="applied">Applied</option>
          <option value="interview">Interview</option>
          <option value="offer">Offer</option>
          <option value="rejected_by_score">Rejected By Score</option>
          <option value="rejected">Rejected</option>
        </select>

        <select
          value={filters.source || 'all'}
          onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
          className="select-input"
        >
          <option value="all">All Sources</option>
          {availableSources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>

        <select
          value={filters.minScore !== undefined ? String(filters.minScore) : 'all'}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              minScore: e.target.value === 'all' ? undefined : Number(e.target.value),
            }))
          }
          className="select-input"
        >
          <option value="all">All Fit Scores</option>
          <option value="75">High Fit (≥ 75%)</option>
          <option value="50">Medium Fit (≥ 50%)</option>
          <option value="0">Any Scored</option>
        </select>
      </div>

      {/* Grid or Empty State */}
      {filteredJobs.length === 0 ? (
        <div className="empty-state">
          <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            No jobs match your filters
          </h3>
          <p style={{ fontSize: '0.875rem' }}>
            Try broadening your search query or reset the status and source filters.
          </p>
        </div>
      ) : (
        <div className="job-grid">
          {filteredJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              threshold={threshold}
              onSelect={onSelectJob}
              onTailored={onJobUpdated}
            />
          ))}
        </div>
      )}
    </div>
  );
};
