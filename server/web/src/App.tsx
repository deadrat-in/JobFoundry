import React, { useState, useEffect, useCallback } from 'react';
import { Job, JobStatus } from './types/job';
import { api } from './api/client';
import { loadSettings, saveSettings, AppSettings } from './lib/auth';
import { JobFeed } from './features/feed/JobFeed';
import { KanbanBoard } from './features/tracker/KanbanBoard';
import { JobDetailModal } from './features/detail/JobDetailModal';
import { SettingsModal } from './features/settings/SettingsModal';

export const App: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'feed' | 'tracker'>('feed');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Sync API client with current settings
  useEffect(() => {
    api.setBaseUrl(settings.apiUrl);
    api.setApiKey(settings.apiKey || null);
  }, [settings]);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getJobs({ limit: 200 });
      setJobs(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load jobs from server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleStatusChange = async (jobId: string, newStatus: JobStatus) => {
    try {
      const updated = await api.updateStatus(jobId, newStatus);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      if (selectedJob && selectedJob.id === jobId) {
        setSelectedJob(updated);
      }
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  const handleJobUpdated = (updatedJob: Job) => {
    setJobs((prev) => prev.map((j) => (j.id === updatedJob.id ? updatedJob : j)));
    if (selectedJob && selectedJob.id === updatedJob.id) {
      setSelectedJob(updatedJob);
    }
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    fetchJobs();
  };

  // Metrics
  const totalJobs = jobs.length;
  const scoredJobs = jobs.filter((j) => j.fit_score !== null && j.fit_score !== undefined);
  const avgScore = scoredJobs.length
    ? Math.round(scoredJobs.reduce((acc, j) => acc + (j.fit_score || 0), 0) / scoredJobs.length)
    : 0;
  const tailoredCount = jobs.filter((j) => j.status === 'tailored' || j.tailored_resume_id).length;
  const highFitCount = jobs.filter((j) => (j.fit_score || 0) >= settings.threshold).length;

  return (
    <div className="app-container">
      {/* Navigation */}
      <header className="navbar">
        <div className="nav-brand">
          <span style={{ fontSize: '1.5rem' }}>⚡</span>
          <span>
            Job<span className="brand-gradient">Foundry</span>
          </span>
        </div>

        <div className="nav-tabs">
          <button
            onClick={() => setActiveTab('feed')}
            className={`nav-tab ${activeTab === 'feed' ? 'active' : ''}`}
          >
            📋 Job Feed
          </button>
          <button
            onClick={() => setActiveTab('tracker')}
            className={`nav-tab ${activeTab === 'tracker' ? 'active' : ''}`}
          >
            📊 Application Tracker
          </button>
        </div>

        <div className="nav-actions">
          <button onClick={fetchJobs} className="btn btn-secondary btn-sm" title="Refresh Feed">
            🔄 Refresh
          </button>
          <button onClick={() => setIsSettingsOpen(true)} className="btn btn-secondary btn-sm" title="Settings">
            ⚙️ Settings
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Live Metrics */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon-wrapper" style={{ color: 'var(--color-blue)' }}>
              💼
            </div>
            <div>
              <div className="stat-val">{totalJobs}</div>
              <div className="stat-label">Total Ingested Jobs</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper" style={{ color: 'var(--color-green)' }}>
              🎯
            </div>
            <div>
              <div className="stat-val">{avgScore}%</div>
              <div className="stat-label">Average Fit Score</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper" style={{ color: 'var(--color-purple)' }}>
              ✨
            </div>
            <div>
              <div className="stat-val">{tailoredCount}</div>
              <div className="stat-label">Tailored Resumes</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper" style={{ color: 'var(--color-amber)' }}>
              🔥
            </div>
            <div>
              <div className="stat-val">{highFitCount}</div>
              <div className="stat-label">Qualified (≥ {settings.threshold}%)</div>
            </div>
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: '1rem',
              marginBottom: '1.5rem',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-md)',
              color: '#fca5a5',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{error}</span>
            <button onClick={fetchJobs} className="btn btn-secondary btn-sm">
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
            Loading jobs from database...
          </div>
        ) : activeTab === 'feed' ? (
          <JobFeed
            jobs={jobs}
            threshold={settings.threshold}
            onSelectJob={setSelectedJob}
            onJobUpdated={handleJobUpdated}
          />
        ) : (
          <KanbanBoard
            jobs={jobs}
            threshold={settings.threshold}
            onSelectJob={setSelectedJob}
            onStatusChange={handleStatusChange}
          />
        )}
      </main>

      {/* Modals */}
      <JobDetailModal
        job={selectedJob}
        threshold={settings.threshold}
        onClose={() => setSelectedJob(null)}
        onStatusChange={handleStatusChange}
        onJobUpdated={handleJobUpdated}
      />

      <SettingsModal
        settings={settings}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
      />
    </div>
  );
};
