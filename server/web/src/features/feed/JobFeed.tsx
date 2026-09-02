import React, { useState, useMemo } from 'react';
import { Job } from '../../types/job';
import { JobCard } from './JobCard';
import { filterJobs, FilterCriteria } from '../filters/filterUtils';

interface JobFeedProps {
  jobs: Job[];
  threshold?: number;
  initialFilters?: Partial<FilterCriteria>;
  onSelectJob: (job: Job) => void;
  onJobUpdated?: (updatedJob: Job) => void;
}

export type SortOption =
  | 'score_desc'
  | 'score_asc'
  | 'created_desc'
  | 'created_asc'
  | 'company_asc'
  | 'title_asc'
  | 'status';

export const JobFeed: React.FC<JobFeedProps> = ({
  jobs,
  threshold = 75,
  initialFilters,
  onSelectJob,
  onJobUpdated,
}) => {
  const [filters, setFilters] = useState<FilterCriteria>({
    search: initialFilters?.search ?? '',
    status: initialFilters?.status ?? 'all',
    source: initialFilters?.source ?? 'all',
    minScore: initialFilters?.minScore,
  });

  const [sortOption, setSortOption] = useState<SortOption>('score_desc');

  const availableSources = useMemo(() => {
    return Array.from(new Set(jobs.map((j) => j.source))).filter(Boolean);
  }, [jobs]);

  const sortedAndFilteredJobs = useMemo(() => {
    const list = filterJobs(jobs, filters);
    return [...list].sort((a, b) => {
      switch (sortOption) {
        case 'score_desc': {
          const aScore = a.fit_score ?? -1;
          const bScore = b.fit_score ?? -1;
          if (aScore !== bScore) return bScore - aScore;
          return (b.created_at || 0) - (a.created_at || 0);
        }
        case 'score_asc': {
          const aScore = a.fit_score ?? 999;
          const bScore = b.fit_score ?? 999;
          if (aScore !== bScore) return aScore - bScore;
          return (b.created_at || 0) - (a.created_at || 0);
        }
        case 'created_asc':
          return (a.created_at || 0) - (b.created_at || 0);
        case 'company_asc':
          return (a.company || '').localeCompare(b.company || '');
        case 'title_asc':
          return (a.title || '').localeCompare(b.title || '');
        case 'status':
          return (a.status || '').localeCompare(b.status || '');
        case 'created_desc':
        default:
          return (b.created_at || 0) - (a.created_at || 0);
      }
    });
  }, [jobs, filters, sortOption]);

  const hasActiveFilters =
    Boolean(filters.search) ||
    filters.status !== 'all' ||
    filters.source !== 'all' ||
    filters.minScore !== undefined;

  const resetFilters = () => {
    setFilters({
      search: '',
      status: 'all',
      source: 'all',
      minScore: undefined,
    });
  };

  return (
    <div>
      {/* Filters and Sorting Bar */}
      <div className="filters-bar" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div className="search-input-wrapper" style={{ flex: '1 1 240px', minWidth: '200px' }}>
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search title, company, skills..."
            value={filters.search || ''}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            className="input-text"
          />
        </div>

        {/* Sort Controls */}
        <select
          value={sortOption}
          onChange={(e) => setSortOption(e.target.value as SortOption)}
          className="select-input"
          style={{ fontWeight: 600, borderLeft: '3px solid var(--accent-primary)' }}
          title="Sort jobs list"
        >
          <option value="score_desc">⚡ Highest Fit Score</option>
          <option value="score_asc">📉 Lowest Fit Score</option>
          <option value="created_desc">🕒 Newest Ingested</option>
          <option value="created_asc">⏳ Oldest Ingested</option>
          <option value="company_asc">🏢 Company (A → Z)</option>
          <option value="title_asc">💼 Role Title (A → Z)</option>
          <option value="status">🏷️ Application Status</option>
        </select>

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
          <option value="invalid_job">Invalid / Non-Job</option>
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
          <option value={String(threshold)}>Qualified (≥ {threshold}%)</option>
          <option value="50">Medium Fit (≥ 50%)</option>
          <option value="0">Any Scored</option>
        </select>

        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
          >
            ✕ Clear Filters
          </button>
        )}
      </div>

      {/* Results Header Info */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          margin: '0.75rem 0 1.25rem 0',
          padding: '0 0.25rem',
          fontSize: '0.85rem',
          color: 'var(--text-secondary)',
        }}
      >
        <div>
          Showing <strong>{sortedAndFilteredJobs.length}</strong> of {jobs.length} jobs
          {hasActiveFilters && (
            <span style={{ marginLeft: '0.5rem', color: 'var(--accent-primary)', fontWeight: 500 }}>
              (filtered)
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Sorted by:{' '}
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            {sortOption === 'score_desc' && 'Highest Fit Score'}
            {sortOption === 'score_asc' && 'Lowest Fit Score'}
            {sortOption === 'created_desc' && 'Newest Ingested'}
            {sortOption === 'created_asc' && 'Oldest Ingested'}
            {sortOption === 'company_asc' && 'Company A-Z'}
            {sortOption === 'title_asc' && 'Role Title A-Z'}
            {sortOption === 'status' && 'Status'}
          </span>
        </div>
      </div>

      {/* Grid or Empty State */}
      {sortedAndFilteredJobs.length === 0 ? (
        <div className="empty-state">
          <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            No jobs match your filters
          </h3>
          <p style={{ fontSize: '0.875rem' }}>
            Try broadening your search query or reset the status and source filters.
          </p>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="btn btn-primary btn-sm"
              style={{ marginTop: '1rem' }}
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="job-grid">
          {sortedAndFilteredJobs.map((job) => (
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
