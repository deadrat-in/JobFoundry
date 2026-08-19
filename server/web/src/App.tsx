import React, { useState, useEffect, useCallback } from 'react';
import { Job, JobStatus } from './types/job';
import { api } from './api/client';
import { loadSettings, saveSettings, AppSettings } from './lib/auth';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginView } from './features/auth/LoginView';
import { RegisterView } from './features/auth/RegisterView';
import { ResumeManager } from './features/resume/ResumeManager';
import { JobFeed } from './features/feed/JobFeed';
import { KanbanBoard } from './features/tracker/KanbanBoard';
import { JobDetailModal } from './features/detail/JobDetailModal';
import { SettingsModal } from './features/settings/SettingsModal';

const DashboardContent: React.FC = () => {
  const { user, token, loading: authLoading, logout } = useAuth();
  const [authView, setAuthView] = useState<'login' | 'register'>('login');

  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'feed' | 'tracker' | 'resume'>('feed');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Sync API client with current settings & token
  useEffect(() => {
    api.setBaseUrl(settings.apiUrl);
    api.setApiKey(token || settings.apiKey || null);
  }, [settings, token]);

  const fetchJobs = useCallback(async () => {
    if (!token && !settings.apiKey) {
      setLoading(false);
      return;
    }
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
  }, [token, settings.apiKey]);

  useEffect(() => {
    if (user) {
      fetchJobs();
    }
  }, [user, fetchJobs]);

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Authenticating...
      </div>
    );
  }

  if (!user) {
    if (authView === 'register') {
      return <RegisterView onSwitchToLogin={() => setAuthView('login')} />;
    }
    return <LoginView onSwitchToRegister={() => setAuthView('register')} />;
  }

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
          <button
            onClick={() => setActiveTab('resume')}
            className={`nav-tab ${activeTab === 'resume' ? 'active' : ''}`}
          >
            📄 Profile & Resume
          </button>
        </div>

        <div className="nav-actions">
          <button onClick={fetchJobs} className="btn btn-secondary btn-sm" title="Refresh Feed">
            🔄 Refresh
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="btn btn-secondary btn-sm"
            title="Settings"
          >
            ⚙️ Settings
          </button>
          <button
            onClick={logout}
            className="btn btn-secondary btn-sm"
            style={{ borderRadius: 'var(--radius-full)' }}
            title="Sign Out"
          >
            🚪 Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {activeTab !== 'resume' && (
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
        )}

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

        {activeTab === 'resume' ? (
          <ResumeManager />
        ) : loading ? (
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

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <DashboardContent />
    </AuthProvider>
  );
};
