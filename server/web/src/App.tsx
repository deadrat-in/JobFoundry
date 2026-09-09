import React, { useState, useEffect, useCallback } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  NavLink,
  useNavigate,
  useParams,
  useLocation,
} from 'react-router-dom';
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
import { PipelineView } from './features/pipeline/PipelineView';
import { ExtensionSyncView } from './features/sync/ExtensionSyncView';
import { AddJobModal } from './features/feed/AddJobModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  Briefcase,
  Kanban,
  Activity,
  FileText,
  Puzzle,
  Plus,
  RefreshCw,
  Settings,
  LogOut,
  Target,
  Sparkles,
  Flame,
} from 'lucide-react';

interface DashboardContentProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  jobs: Job[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onJobUpdated: (job: Job) => void;
  onJobDeleted: (jobId: string) => void;
  onStatusChange: (jobId: string, status: JobStatus) => Promise<void>;
}

const JobDetailWrapper: React.FC<{
  jobs: Job[];
  threshold: number;
  onStatusChange: (jobId: string, status: JobStatus) => Promise<void>;
  onJobUpdated: (job: Job) => void;
  onJobDeleted: (jobId: string) => void;
}> = ({ jobs, threshold, onStatusChange, onJobUpdated, onJobDeleted }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [singleJob, setSingleJob] = useState<Job | null>(null);
  const [loadingSingle, setLoadingSingle] = useState(false);

  const matchedJob = jobs.find((j) => j.id === id) || singleJob;

  useEffect(() => {
    if (id && !jobs.some((j) => j.id === id)) {
      setLoadingSingle(true);
      api
        .getJob(id)
        .then((j) => setSingleJob(j))
        .catch(() => setSingleJob(null))
        .finally(() => setLoadingSingle(false));
    }
  }, [id, jobs]);

  const handleClose = () => {
    navigate(-1);
  };

  if (loadingSingle) {
    return null;
  }

  return (
    <JobDetailModal
      job={matchedJob}
      threshold={threshold}
      onClose={handleClose}
      onStatusChange={onStatusChange}
      onJobUpdated={(updated) => {
        setSingleJob(updated);
        onJobUpdated(updated);
      }}
      onDeleteJob={(deletedId) => {
        onJobDeleted(deletedId);
      }}
    />
  );
};

const DashboardLayout: React.FC<DashboardContentProps> = ({
  settings,
  onSaveSettings,
  jobs,
  loading,
  error,
  onRefresh,
  onJobUpdated,
  onJobDeleted,
  onStatusChange,
}) => {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isSettingsOpen = location.pathname === '/settings';
  const [isAddJobOpen, setIsAddJobOpen] = useState(false);
  const [feedInitialFilters, setFeedInitialFilters] = useState<any>(undefined);

  // Metrics
  const totalJobs = jobs.length;
  const scoredJobs = jobs.filter((j) => j.fit_score !== null && j.fit_score !== undefined);
  const avgScore = scoredJobs.length
    ? Math.round(scoredJobs.reduce((acc, j) => acc + (j.fit_score || 0), 0) / scoredJobs.length)
    : 0;
  const tailoredCount = jobs.filter((j) => j.status === 'tailored' || j.tailored_resume_id).length;
  const highFitCount = jobs.filter((j) => (j.fit_score || 0) >= settings.threshold).length;

  const isStandalonePage =
    location.pathname.startsWith('/resume') ||
    location.pathname.startsWith('/profile') ||
    location.pathname.startsWith('/pipeline') ||
    location.pathname.startsWith('/extension-sync');

  return (
    <div className="app-container">
      {/* Navigation */}
      <header className="navbar">
        <div className="nav-brand">
          <img
            src="/icons/logo.webp"
            alt="JobFoundry Logo"
            style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'contain' }}
          />
          <span>
            Job<span className="brand-gradient">Foundry</span>
          </span>
        </div>

        <nav className="nav-tabs">
          <NavLink to="/feed" className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}>
            <Briefcase size={16} /> Job Feed
          </NavLink>
          <NavLink
            to="/tracker"
            className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}
          >
            <Kanban size={16} /> Tracker
          </NavLink>
          <NavLink
            to="/pipeline"
            className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}
          >
            <Activity size={16} /> Pipeline Monitor
          </NavLink>
          <NavLink
            to="/profile"
            className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}
          >
            <FileText size={16} /> Master Profile
          </NavLink>
          <NavLink
            to="/extension-sync"
            className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}
          >
            <Puzzle size={16} /> Extension Sync
          </NavLink>
        </nav>

        <div className="nav-actions">
          <button
            onClick={() => setIsAddJobOpen(true)}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Plus size={15} /> Add Job
          </button>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="btn btn-secondary btn-sm"
            title="Refresh jobs from server"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            onClick={() => navigate('/settings')}
            className={`btn btn-secondary btn-sm ${isSettingsOpen ? 'btn-primary' : ''}`}
            title="Settings"
            aria-label="Settings"
          >
            <Settings size={16} />
          </button>
          <button
            onClick={logout}
            className="btn btn-secondary btn-sm"
            title="Sign out"
            aria-label="Sign out"
            style={{ color: 'var(--text-muted)' }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {!isStandalonePage && (
          <div className="stats-grid">
            <div
              className="stat-card"
              onClick={() => {
                setFeedInitialFilters({ status: 'all', minScore: undefined });
                navigate('/feed');
              }}
              style={{ cursor: 'pointer' }}
              title="Click to view all jobs in feed"
            >
              <div className="stat-icon-wrapper" style={{ color: 'var(--color-blue)' }}>
                <Briefcase size={22} />
              </div>
              <div>
                <div className="stat-val">{totalJobs}</div>
                <div className="stat-label">Total Ingested Jobs</div>
              </div>
            </div>

            <div
              className="stat-card"
              onClick={() => {
                setFeedInitialFilters({ minScore: 50 });
                navigate('/feed');
              }}
              style={{ cursor: 'pointer' }}
              title="Click to view jobs with ≥ 50% match"
            >
              <div className="stat-icon-wrapper" style={{ color: 'var(--color-green)' }}>
                <Target size={22} />
              </div>
              <div>
                <div className="stat-val">{avgScore}%</div>
                <div className="stat-label">Average Fit Score</div>
              </div>
            </div>

            <div
              className="stat-card"
              onClick={() => {
                setFeedInitialFilters({ status: 'tailored' });
                navigate('/feed');
              }}
              style={{ cursor: 'pointer' }}
              title="Click to view tailored jobs"
            >
              <div className="stat-icon-wrapper" style={{ color: 'var(--color-purple)' }}>
                <Sparkles size={22} />
              </div>
              <div>
                <div className="stat-val">{tailoredCount}</div>
                <div className="stat-label">Tailored Resumes</div>
              </div>
            </div>

            <div
              className="stat-card"
              onClick={() => {
                setFeedInitialFilters({ minScore: settings.threshold });
                navigate('/feed');
              }}
              style={{ cursor: 'pointer' }}
              title={`Click to view qualified jobs (≥ ${settings.threshold}%)`}
            >
              <div className="stat-icon-wrapper" style={{ color: 'var(--color-amber)' }}>
                <Flame size={22} />
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
            <button onClick={onRefresh} className="btn btn-secondary btn-sm">
              Retry
            </button>
          </div>
        )}

        {loading && !isStandalonePage ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
            Loading jobs from database...
          </div>
        ) : (
          <Routes>
            <Route
              path="/feed"
              element={
                <JobFeed
                  jobs={jobs}
                  threshold={settings.threshold}
                  initialFilters={feedInitialFilters}
                  onSelectJob={(job) => navigate(`/jobs/${job.id}`)}
                  onJobUpdated={onJobUpdated}
                  onJobDeleted={onJobDeleted}
                  onStatusChange={onStatusChange}
                />
              }
            />
            <Route
              path="/tracker"
              element={
                <KanbanBoard
                  jobs={jobs}
                  threshold={settings.threshold}
                  onSelectJob={(job) => navigate(`/jobs/${job.id}`)}
                  onStatusChange={onStatusChange}
                />
              }
            />
            <Route
              path="/pipeline"
              element={<PipelineView onSelectJob={(jobId) => navigate(`/jobs/${jobId}`)} />}
            />
            <Route path="/profile" element={<ResumeManager />} />
            <Route path="/resume" element={<Navigate to="/profile" replace />} />
            <Route path="/extension-sync" element={<ExtensionSyncView />} />
            <Route
              path="/jobs/:id"
              element={
                <>
                  <JobFeed
                    jobs={jobs}
                    threshold={settings.threshold}
                    initialFilters={feedInitialFilters}
                    onSelectJob={(job) => navigate(`/jobs/${job.id}`)}
                    onJobUpdated={onJobUpdated}
                    onJobDeleted={onJobDeleted}
                    onStatusChange={onStatusChange}
                    selectedJobId={location.pathname.split('/')[2]}
                  />
                  <JobDetailWrapper
                    jobs={jobs}
                    threshold={settings.threshold}
                    onStatusChange={onStatusChange}
                    onJobUpdated={onJobUpdated}
                    onJobDeleted={onJobDeleted}
                  />
                </>
              }
            />
            <Route
              path="/settings"
              element={
                <>
                  <JobFeed
                    jobs={jobs}
                    threshold={settings.threshold}
                    onSelectJob={(job) => navigate(`/jobs/${job.id}`)}
                    onJobUpdated={onJobUpdated}
                  />
                  <SettingsModal
                    settings={settings}
                    isOpen={true}
                    onClose={() => navigate(-1)}
                    onSave={onSaveSettings}
                  />
                </>
              }
            />
            <Route path="*" element={<Navigate to="/feed" replace />} />
          </Routes>
        )}

        {isAddJobOpen && (
          <AddJobModal
            onClose={() => setIsAddJobOpen(false)}
            onJobAdded={(newJob) => {
              onJobUpdated(newJob);
              onRefresh();
            }}
          />
        )}
      </main>
    </div>
  );
};

const DashboardRoot: React.FC = () => {
  const { user, token, loading: authLoading, logout } = useAuth();
  const navigate = useNavigate();

  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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
      if (err.status === 401) {
        logout();
        return;
      }
      setError(err.message || 'Failed to load jobs from server');
    } finally {
      setLoading(false);
    }
  }, [token, settings.apiKey, logout]);

  useEffect(() => {
    if (user) {
      fetchJobs();
    }
  }, [user, fetchJobs]);

  const handleStatusChange = async (jobId: string, newStatus: JobStatus) => {
    try {
      const updated = await api.updateStatus(jobId, newStatus);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  const handleJobUpdated = (updatedJob: Job) => {
    setJobs((prev) => prev.map((j) => (j.id === updatedJob.id ? updatedJob : j)));
  };

  const handleJobDeleted = (deletedId: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== deletedId));
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    fetchJobs();
  };

  if (authLoading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
        }}
      >
        Authenticating...
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route
          path="/register"
          element={<RegisterView onSwitchToLogin={() => navigate('/login')} />}
        />
        <Route path="*" element={<LoginView onSwitchToRegister={() => navigate('/register')} />} />
      </Routes>
    );
  }

  return (
    <ErrorBoundary fallbackTitle="Dashboard Error">
      <DashboardLayout
        settings={settings}
        onSaveSettings={handleSaveSettings}
        jobs={jobs}
        loading={loading}
        error={error}
        onRefresh={fetchJobs}
        onJobUpdated={handleJobUpdated}
        onJobDeleted={handleJobDeleted}
        onStatusChange={handleStatusChange}
      />
    </ErrorBoundary>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DashboardRoot />
      </AuthProvider>
    </BrowserRouter>
  );
};
