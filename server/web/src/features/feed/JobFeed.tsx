import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Job, JobStatus } from '../../types/job';
import { api } from '../../api/client';
import { JobCard } from './JobCard';
import { TriageListItem } from './TriageListItem';
import { JobWorkbench } from './JobWorkbench';
import { KeyboardHelpModal } from './KeyboardHelpModal';
import { filterJobs, FilterCriteria } from '../filters/filterUtils';
import { Search, LayoutList, LayoutGrid, X, Keyboard } from 'lucide-react';

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

  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastGPressTimeRef = useRef<number>(0);
  const tailoringJobIdRef = useRef<string | null>(null);

  const [hasActiveResume, setHasActiveResume] = useState<boolean | null>(null);

  useEffect(() => {
    if (jobs.length === 0) {
      api
        .getActiveResume()
        .then((res) => setHasActiveResume(Boolean(res?.resume)))
        .catch(() => setHasActiveResume(false));
    }
  }, [jobs.length]);

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

  // Synchronize when external selection changes
  useEffect(() => {
    if (externalSelectedJobId) {
      setActiveJobId(externalSelectedJobId);
    }
  }, [externalSelectedJobId]);

  // Keep active job valid within current filtered/sorted view
  useEffect(() => {
    if (sortedAndFilteredJobs.length > 0) {
      if (!activeJobId || !sortedAndFilteredJobs.some((j) => j.id === activeJobId)) {
        setActiveJobId(sortedAndFilteredJobs[0].id);
      }
    } else {
      setActiveJobId(null);
    }
  }, [sortedAndFilteredJobs, activeJobId]);

  // Global keyboard shortcuts for triage station
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused = Boolean(
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      );

      if (isInputFocused) {
        if (e.key === 'Escape') {
          target.blur();
        }
        return;
      }

      // Cmd+K or Ctrl+K to search
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Ignore single-key triage shortcuts when modifier keys are held (e.g. Ctrl+S, Ctrl+A, Alt+Left)
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      // If help modal is open, only allow Escape or ? to close it
      if (isHelpModalOpen) {
        if (e.key === 'Escape' || e.key === '?') {
          e.preventDefault();
          setIsHelpModalOpen(false);
        }
        return;
      }

      // / to search
      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // ? to open help modal
      if (e.key === '?') {
        e.preventDefault();
        setIsHelpModalOpen(true);
        return;
      }

      if (sortedAndFilteredJobs.length === 0) return;

      const currentIndex = sortedAndFilteredJobs.findIndex((j) => j.id === activeJobId);

      // Vim movement: j or Down arrow
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

      // Vim movement: k or Up arrow
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

      // Vim movement: gg (top of list)
      if (e.key === 'g') {
        const now = Date.now();
        if (now - lastGPressTimeRef.current < 500) {
          e.preventDefault();
          const targetJob = sortedAndFilteredJobs[0];
          setActiveJobId(targetJob.id);
          const el = document.querySelector(`[data-job-id="${targetJob.id}"]`);
          if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          lastGPressTimeRef.current = 0;
        } else {
          lastGPressTimeRef.current = now;
        }
        return;
      }

      // Vim movement: G (Shift+G, bottom of list)
      if (e.key === 'G') {
        e.preventDefault();
        const targetJob = sortedAndFilteredJobs[sortedAndFilteredJobs.length - 1];
        setActiveJobId(targetJob.id);
        const el = document.querySelector(`[data-job-id="${targetJob.id}"]`);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        return;
      }

      // Open listing: o or O (or Enter when not focused on an interactive button/link)
      const isInteractiveTarget = Boolean(
        target &&
        typeof target.getAttribute === 'function' &&
        (target.tagName === 'BUTTON' ||
          target.tagName === 'A' ||
          target.getAttribute('role') === 'button')
      );

      if (e.key === 'o' || e.key === 'O' || (e.key === 'Enter' && !isInteractiveTarget)) {
        const activeJob = sortedAndFilteredJobs.find((j) => j.id === activeJobId);
        if (activeJob?.url) {
          e.preventDefault();
          window.open(activeJob.url, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      // Save/Star toggle: s
      if (e.key === 's' || e.key === 'S') {
        const activeJob = sortedAndFilteredJobs.find((j) => j.id === activeJobId);
        if (activeJob && onStatusChange) {
          e.preventDefault();
          const nextStatus: JobStatus = activeJob.status === 'saved' ? 'new' : 'saved';
          onStatusChange(activeJob.id, nextStatus);
        }
        return;
      }

      // Archive job: e
      if (e.key === 'e' || e.key === 'E') {
        const activeJob = sortedAndFilteredJobs.find((j) => j.id === activeJobId);
        if (activeJob && onStatusChange) {
          e.preventDefault();
          onStatusChange(activeJob.id, 'archived');
        }
        return;
      }

      // Mark Applied: a
      if (e.key === 'a' || e.key === 'A') {
        const activeJob = sortedAndFilteredJobs.find((j) => j.id === activeJobId);
        if (activeJob && onStatusChange) {
          e.preventDefault();
          onStatusChange(activeJob.id, 'applied');
        }
        return;
      }

      // Tailor CV: t (guarded against concurrent requests)
      if (e.key === 't' || e.key === 'T') {
        const activeJob = sortedAndFilteredJobs.find((j) => j.id === activeJobId);
        if (
          activeJob &&
          activeJob.status !== 'tailored' &&
          !activeJob.tailored_resume_id &&
          tailoringJobIdRef.current !== activeJob.id
        ) {
          e.preventDefault();
          tailoringJobIdRef.current = activeJob.id;
          api
            .tailor(activeJob.id)
            .then((res) => {
              if (onJobUpdated) onJobUpdated(res.job);
            })
            .catch((err) => {
              alert(err.message || 'Failed to tailor CV');
            })
            .finally(() => {
              tailoringJobIdRef.current = null;
            });
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sortedAndFilteredJobs, activeJobId, onStatusChange, onJobUpdated, isHelpModalOpen]);

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
      {/* Keyboard Help Modal */}
      <KeyboardHelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)} />

      {/* Keyboard Shortcut Hint Bar */}
      <div
        className="keyboard-hint-bar"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Quick Triage:</span>
          <span className="keyboard-hint-item">
            <span className="kbd-pill">J</span> / <span className="kbd-pill">K</span> Next/Prev
          </span>
          <span className="keyboard-hint-item">
            <span className="kbd-pill">O</span> Open Post
          </span>
          <span className="keyboard-hint-item">
            <span className="kbd-pill">S</span> Save
          </span>
          <span className="keyboard-hint-item">
            <span className="kbd-pill">E</span> Archive
          </span>
          <span className="keyboard-hint-item">
            <span className="kbd-pill">A</span> Apply
          </span>
          <span className="keyboard-hint-item">
            <span className="kbd-pill">T</span> Tailor
          </span>
          <span className="keyboard-hint-item">
            <span className="kbd-pill">/</span> Search
          </span>
        </div>
        <button
          onClick={() => setIsHelpModalOpen(true)}
          className="btn btn-secondary btn-sm"
          style={{
            fontSize: '0.75rem',
            padding: '0.2rem 0.5rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            marginLeft: 'auto',
          }}
          title="View all shortcuts (press ?)"
        >
          <Keyboard size={13} /> Shortcuts{' '}
          <span className="kbd-pill" style={{ marginLeft: 2 }}>
            ?
          </span>
        </button>
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
          <option value="saved">Saved</option>
          <option value="tailored">Tailored</option>
          <option value="applied">Applied</option>
          <option value="interview">Interview</option>
          <option value="offer">Offer</option>
          <option value="archived">Archived</option>
          <option value="rejected">Rejected</option>
          <option value="rejected_by_score">Rejected By Score</option>
          <option value="invalid_job">Invalid / Non-Job</option>
          <option value="score_failed">Score Failed (Setup Required)</option>
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
        hasActiveFilters ? (
          <div className="empty-state">
            <h3
              style={{ fontSize: '1.1rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}
            >
              No jobs match your filters
            </h3>
            <p style={{ fontSize: '0.875rem' }}>
              Try broadening your search query or reset the status and source filters.
            </p>
            <button
              onClick={resetFilters}
              className="btn btn-primary btn-sm"
              style={{ marginTop: '1rem' }}
            >
              Reset Filters
            </button>
          </div>
        ) : hasActiveResume === false ? (
          /* Step 1: AI Model -> Step 2: Master Resume -> Step 3: Ingestion */
          <div className="onboarding-hero">
            <div className="onboarding-hero-header">
              <div className="onboarding-hero-title">
                <span>🚀</span> Welcome to JobFoundry!
              </div>
              <p className="onboarding-hero-subtitle">
                Set up your career command center in 3 steps to unlock automated AI scoring, match
                evaluation, and tailored resumes.
              </p>
            </div>

            <div className="onboarding-steps">
              <div className="onboarding-step-card">
                <div>
                  <span className="onboarding-step-badge">Step 1 • AI Settings</span>
                  <div className="onboarding-step-title">Configure AI Model & Key</div>
                  <div className="onboarding-step-desc">
                    Verify your LLM model (OpenRouter, OpenAI, or Anthropic) used to screen jobs and
                    tailor applications.
                  </div>
                </div>
                <a
                  href="/settings?tab=scorer"
                  className="btn btn-primary btn-sm"
                  style={{ textDecoration: 'none', textAlign: 'center' }}
                >
                  Configure AI Scorer →
                </a>
              </div>

              <div className="onboarding-step-card">
                <div>
                  <span className="onboarding-step-badge">Step 2 • Master Profile</span>
                  <div className="onboarding-step-title">Upload Master Resume</div>
                  <div className="onboarding-step-desc">
                    Add your master JSON Resume to anchor job evaluations and experience bullet
                    tailoring.
                  </div>
                </div>
                <a
                  href="/settings?tab=profile"
                  className="btn btn-primary btn-sm"
                  style={{ textDecoration: 'none', textAlign: 'center' }}
                >
                  Set Up Resume →
                </a>
              </div>

              <div className="onboarding-step-card">
                <div>
                  <span className="onboarding-step-badge">Step 3 • Ingestion</span>
                  <div className="onboarding-step-title">Connect Job Sources</div>
                  <div className="onboarding-step-desc">
                    Pair the browser extension for 1-click capture or configure automated portal
                    scrapers.
                  </div>
                </div>
                <a
                  href="/settings?tab=sync"
                  className="btn btn-secondary btn-sm"
                  style={{ textDecoration: 'none', textAlign: 'center' }}
                >
                  Connect Sources →
                </a>
              </div>
            </div>
          </div>
        ) : (
          /* Resume is present, waiting for first job scan/capture */
          <div className="onboarding-hero">
            <div className="onboarding-hero-header">
              <div className="onboarding-hero-title">
                <span>⚡</span> Master Profile Ready — Let's Ingest Jobs!
              </div>
              <p className="onboarding-hero-subtitle">
                Your Master Resume and AI Fit Scorer are ready. Ingest your first listings to start
                seeing match scores and tailored resumes.
              </p>
            </div>

            <div className="onboarding-steps">
              <div className="onboarding-step-card">
                <div>
                  <span className="onboarding-step-badge">Browser Extension</span>
                  <div className="onboarding-step-title">1-Click Live Capture</div>
                  <div className="onboarding-step-desc">
                    Browse jobs naturally on LinkedIn, Indeed, Greenhouse, or Lever and capture in 1
                    click.
                  </div>
                </div>
                <a
                  href="/settings?tab=sync"
                  className="btn btn-primary btn-sm"
                  style={{ textDecoration: 'none', textAlign: 'center' }}
                >
                  Pair Extension →
                </a>
              </div>

              <div className="onboarding-step-card">
                <div>
                  <span className="onboarding-step-badge">Portal Catalog</span>
                  <div className="onboarding-step-title">Automated Feeds</div>
                  <div className="onboarding-step-desc">
                    Activate automated scrapers from Himalayas, RemoteOK, Arbeitnow, and 30+ boards.
                  </div>
                </div>
                <a
                  href="/settings?tab=scrapers"
                  className="btn btn-secondary btn-sm"
                  style={{ textDecoration: 'none', textAlign: 'center' }}
                >
                  Configure Portals →
                </a>
              </div>
            </div>
          </div>
        )
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
