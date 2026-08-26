import React, { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { ErrorBoundary } from '../../components/ErrorBoundary';

interface PipelineJob {
  id: string;
  title: string;
  company: string;
  source: string;
  location?: string;
  status: string;
  fit_score: number | null;
  has_description: boolean | number;
  created_at: number;
  updated_at: number;
}

interface PipelineStats {
  total: number;
  unscored: number;
  scored: number;
  tailored: number;
  failed: number;
}

export const PipelineView: React.FC<{
  onSelectJob?: (jobId: string) => void;
}> = ({ onSelectJob }) => {
  const [stats, setStats] = useState<PipelineStats>({
    total: 0,
    unscored: 0,
    scored: 0,
    tailored: 0,
    failed: 0,
  });
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unscored' | 'scored' | 'tailored' | 'failed'>('all');
  const [activeResumeLoaded, setActiveResumeLoaded] = useState<boolean | null>(null);

  const fetchPipelineData = async () => {
    setLoading(true);
    try {
      const [statsData, jobsData, activeResume] = await Promise.all([
        api.getPipelineStats().catch(() => ({ total: 0, unscored: 0, scored: 0, tailored: 0, failed: 0 })),
        api.getPipelineJobs().catch(() => []),
        api.getActiveResume().catch(() => null),
      ]);
      setStats(statsData);
      setJobs(jobsData);
      setActiveResumeLoaded(Boolean(activeResume?.resume));
    } catch (err) {
      console.error('Failed to load pipeline data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPipelineData();
  }, []);

  const filteredJobs = jobs.filter((j) => {
    if (filter === 'unscored') return j.fit_score === null && j.status !== 'failed';
    if (filter === 'scored') return j.fit_score !== null;
    if (filter === 'tailored') return j.status === 'tailored';
    if (filter === 'failed') return j.status === 'failed' || j.status === 'tailor_failed' || (!j.has_description && j.fit_score === null);
    return true;
  });

  return (
    <ErrorBoundary fallbackTitle="Pipeline View Error">
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.5rem 1rem' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem',
          }}
        >
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>⚡</span> Job & Resume Pipeline Monitor
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              Inspect ingestion, automated fit screening, resume tailoring, and queue health.
            </p>
          </div>
          <button onClick={fetchPipelineData} disabled={loading} className="btn btn-secondary btn-sm">
            {loading ? 'Refreshing...' : '🔄 Refresh Queue'}
          </button>
        </div>

        {/* Master Resume Prerequisite Alert */}
        {activeResumeLoaded === false && (
          <div
            style={{
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: 'var(--radius-md)',
              padding: '1rem 1.25rem',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, color: 'var(--color-yellow, #f59e0b)', marginBottom: '0.2rem' }}>
                ⚠️ No Active Master Resume Detected
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                The background worker will skip fit screening and tailoring until you upload a base JSON Resume.
              </div>
            </div>
            <a href="/profile" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
              Upload Resume →
            </a>
          </div>
        )}

        {/* Pipeline Flow Metrics */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginBottom: '2rem',
          }}
        >
          <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--accent-primary)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>1. Ingested Jobs</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0.35rem 0' }}>{stats.total}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Scraped from active portals</div>
          </div>

          <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--color-yellow, #f59e0b)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>2. Pending Fit Score</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0.35rem 0', color: 'var(--color-yellow, #f59e0b)' }}>
              {stats.unscored}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Queued for LLM screener</div>
          </div>

          <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--color-green, #10b981)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>3. Evaluated & Scored</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0.35rem 0', color: 'var(--color-green, #10b981)' }}>
              {stats.scored}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Matched against resume skills</div>
          </div>

          <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #a855f7' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>4. Tailored Resumes</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0.35rem 0', color: '#a855f7' }}>
              {stats.tailored}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>PDF & ATS artifacts generated</div>
          </div>
        </div>

        {/* Filter Controls */}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            marginBottom: '1rem',
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: '0.75rem',
          }}
        >
          <button
            onClick={() => setFilter('all')}
            className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
          >
            All Jobs ({jobs.length})
          </button>
          <button
            onClick={() => setFilter('unscored')}
            className={`btn btn-sm ${filter === 'unscored' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Unscored ({stats.unscored})
          </button>
          <button
            onClick={() => setFilter('scored')}
            className={`btn btn-sm ${filter === 'scored' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Scored ({stats.scored})
          </button>
          <button
            onClick={() => setFilter('tailored')}
            className={`btn btn-sm ${filter === 'tailored' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Tailored ({stats.tailored})
          </button>
        </div>

        {/* Jobs Pipeline Queue Table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>Job Title & Company</th>
                <th style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>Portal Source</th>
                <th style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>JD Status</th>
                <th style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>Fit Score</th>
                <th style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>Pipeline Stage</th>
                <th style={{ padding: '0.85rem 1rem', fontWeight: 600, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No jobs found in this pipeline filter.
                  </td>
                </tr>
              ) : (
                filteredJobs.map((j) => (
                  <tr
                    key={j.id}
                    style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.15s' }}
                  >
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{j.title}</div>
                      <div style={{ fontSize: '0.775rem', color: 'var(--text-secondary)' }}>
                        {j.company} {j.location ? `• ${j.location}` : ''}
                      </div>
                    </td>
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <span className="badge badge-indigo">{j.source}</span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem' }}>
                      {j.has_description ? (
                        <span style={{ color: 'var(--color-green, #10b981)', fontSize: '0.8rem' }}>✓ Complete JD</span>
                      ) : (
                        <span style={{ color: 'var(--color-red, #ef4444)', fontSize: '0.8rem' }}>✗ Empty JD</span>
                      )}
                    </td>
                    <td style={{ padding: '0.85rem 1rem' }}>
                      {j.fit_score !== null && j.fit_score !== undefined ? (
                        <span
                          className={`score-badge ${j.fit_score >= 75 ? 'score-high' : j.fit_score >= 50 ? 'score-medium' : 'score-low'}`}
                          style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                        >
                          {j.fit_score}%
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Pending</span>
                      )}
                    </td>
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <span
                        className={`badge ${j.status === 'tailored' ? 'badge-purple' : j.status === 'new' ? 'badge-blue' : 'badge-secondary'}`}
                      >
                        {j.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        {onSelectJob && (
                          <button
                            onClick={() => onSelectJob(j.id)}
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '0.75rem' }}
                          >
                            Details →
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            if (window.confirm(`Delete "${j.title}" from database?`)) {
                              try {
                                await api.deleteJob(j.id);
                                fetchPipelineData();
                              } catch (err: any) {
                                alert(`Failed to delete: ${err.message}`);
                              }
                            }
                          }}
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: '0.75rem', color: 'var(--color-red, #ef4444)' }}
                          title="Delete from DB"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ErrorBoundary>
  );
};
