import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Job, JobStatus } from '../../types/job';
import { JobCard } from './JobCard';
import { TriageListItem } from './TriageListItem';
import { JobWorkbench } from './JobWorkbench';
import { filterJobs, FilterCriteria } from '../filters/filterUtils';
import { Search, LayoutList, LayoutGrid, X } from 'lucide-react';

interface JobFeedProps {
  jobs: Job[];
  threshold?: number;
  initialFilters?: Partial<FilterCriteria>;
  selectedJobId?: string;
  onSelectJob: (job: Job) => void;
  onJobUpdated?: (updatedJob: Job) => void;
  onJobDeleted?: (jobId: string) => void;
  onStatusChange?: (jobId: string, newStatus: JobStatus) => Promise<void> | void;
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
  selectedJobId: externalSelectedJobId,
  onSelectJob,
  onJobUpdated,
  onJobDeleted,
  onStatusChange,
}) => {
  const [filters, setFilters] = useState<FilterCriteria>({
    search: initialFilters?.search ?? '',
    status: initialFilters?.status ?? 'all',
    source: initialFilters?.source ?? 'all',
    minScore: initialFilters?.minScore,
  });

  const [sortOption, setSortOption] = useState<SortOption>('score_desc');
  const [viewMode, setViewMode] = useState<'split' | 'grid'>(() => {
    const saved = localStorage.getItem('jf_feed_view_mode');
    return saved === 'grid' ? 'grid' : 'split';
  });

  const [activeJobId, setActiveJobId] = useState<string | null>(externalSelectedJobId || null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleViewModeChange = (mode: 'split' | 'grid') => {
    setViewMode(mode);
    localStorage.setItem('jf_feed_view_mode', mode);
  };

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

  // Keep active job valid
  useEffect(() => {
    if (externalSelectedJobId) {
      setActiveJobId(externalSelectedJobId);
      return;
    }
    if (sortedAndFilteredJobs.length > 0) {
      if (!activeJobId || !sortedAndFilteredJobs.some((j) => j.id === activeJobId)) {
        setActiveJobId(sortedAndFilteredJobs[0].id);
      }
    } else {
      setActiveJobId(null);
    }
  }, [sortedAndFilteredJobs, externalSelectedJobId, activeJobId]);

  // Global keyboard shortcuts for triage station
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        if (e.key === 'Escape') {
          target.blur();
        }
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (sortedAndFilteredJobs.length === 0) return;

      const currentIndex = sortedAndFilteredJobs.findIndex((j) => j.id === activeJobId);

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = currentIndex < sortedAndFilteredJobs.length - 1 ? currentIndex + 1 : 0;
        const targetJob = sortedAndFilteredJobs[nextIndex];
        setActiveJobId(targetJob.id);
        const el = document.querySelector(`[data-job-id="${targetJob.id}"]`);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        return;
      }

      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : sortedAndFilteredJobs.length - 1;
        const targetJob = sortedAndFilteredJobs[prevIndex];
        setActiveJobId(targetJob.id);
        const el = document.querySelector(`[data-job-id="${targetJob.id}"]`);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        return;
      }

      if (e.key === 'o' || e.key === 'O') {
        const activeJob = sortedAndFilteredJobs.find((j) => j.id === activeJobId);
        if (activeJob?.url) {
          e.preventDefault();
          window.open(activeJob.url, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      if (e.key === 's' || e.key === 'S') {
        const activeJob = sortedAndFilteredJobs.find((j) => j.id === activeJobId);
        if (activeJob && onStatusChange) {
          e.preventDefault();
          const nextStatus: JobStatus = activeJob.status === 'saved' ? 'new' : 'saved';
          onStatusChange(activeJob.id, nextStatus);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sortedAndFilteredJobs, activeJobId, onStatusChange]);

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

  const activeJob = useMemo(() => {
    return (
      sortedAndFilteredJobs.find((j) => j.id === activeJobId) || sortedAndFilteredJobs[0] || null
    );
  }, [sortedAndFilteredJobs, activeJobId]);

  return (
    <div>
      {/* Keyboard Shortcut Hint Bar */}
      <div className="keyboard-hint-bar">
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Quick Triage:</span>
        <span className="keyboard-hint-item">
          <span className="kbd-pill">J</span> / <span className="kbd-pill">K</span> Next / Prev Job
        </span>
        <span className="keyboard-hint-item">
          <span className="kbd-pill">O</span> Open Post
        </span>
        <span className="keyboard-hint-item">
          <span className="kbd-pill">S</span> Save / Star
        </span>
        <span className="keyboard-hint-item">
          <span className="kbd-pill">/</span> Search
        </span>
      </div>

      {/* Filters and Sorting Bar */}
      <div
        className="filters-bar"
        style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}
      >
        <div className="search-input-wrapper" style={{ flex: '1 1 240px', minWidth: '200px' }}>
          <span className="search-icon" style={{ display: 'flex', alignItems: 'center' }}>
            <Search size={15} />
          </span>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search title, company, skills... (Press / to focus)"
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
          <option value="score_desc">Highest Fit Score</option>
          <option value="score_asc">Lowest Fit Score</option>
          <option value="created_desc">Newest Ingested</option>
          <option value="created_asc">Oldest Ingested</option>
          <option value="company_asc">Company (A → Z)</option>
          <option value="title_asc">Role Title (A → Z)</option>
          <option value="status">Application Status</option>
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
            style={{
              fontSize: '0.8rem',
              padding: '0.35rem 0.75rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
            }}
          >
            <X size={13} /> Clear
          </button>
        )}

        {/* View Mode Switcher */}
        <div className="view-segmented-control" style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            className={`view-toggle-btn ${viewMode === 'split' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('split')}
            title="Split Triage View"
          >
            <LayoutList size={14} /> Split View
          </button>
          <button
            type="button"
            className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('grid')}
            title="Grid Cards View"
          >
            <LayoutGrid size={14} /> Cards
          </button>
        </div>
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

      {/* Content Rendering: Empty State, Split Triage Station, or Cards Grid */}
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
      ) : viewMode === 'split' ? (
        <div className="triage-station">
          {/* Master List Pane */}
          <div className="triage-list-container">
            <div className="triage-list-header">
              <span>Jobs Queue ({sortedAndFilteredJobs.length})</span>
              <span>Use J / K to step</span>
            </div>
            <div className="triage-list-scroll">
              {sortedAndFilteredJobs.map((job) => (
                <div key={job.id} data-job-id={job.id}>
                  <TriageListItem
                    job={job}
                    threshold={threshold}
                    isActive={job.id === activeJob?.id}
                    onSelect={() => setActiveJobId(job.id)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Workbench Detail Pane */}
          <JobWorkbench
            job={activeJob}
            threshold={threshold}
            onStatusChange={onStatusChange || (() => {})}
            onJobUpdated={(updated) => {
              if (onJobUpdated) onJobUpdated(updated);
            }}
            onDeleteJob={(deletedId) => {
              if (onJobDeleted) onJobDeleted(deletedId);
            }}
          />
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
