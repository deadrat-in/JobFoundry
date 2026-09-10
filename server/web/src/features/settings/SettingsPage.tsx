import React, { useState, useEffect } from 'react';
import { AppSettings, DEFAULT_SETTINGS } from '../../lib/auth';
import { useAuth } from '../../context/AuthContext';
import {
  api,
  SystemSettings,
  SettingMeta,
  DiagnosticsInfo,
  ExtensionConfig,
} from '../../api/client';
import { useTheme, ACCENT_THEMES, ColorMode, AccentTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { ScraperSettingsTab } from './ScraperSettingsTab';
import { extractKeywordsFromResume } from '../../lib/resumeKeywords';
import {
  Laptop,
  Moon,
  Sun,
  Palette,
  Bot,
  FileText,
  Activity,
  Key,
  Database,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Copy,
  Sliders,
  Send,
  Lock,
  Unlock,
  Sparkles,
  Compass,
} from 'lucide-react';

interface SettingsPageProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
}

type SettingsTab =
  'general' | 'scorer' | 'tailor' | 'observability' | 'scrapers' | 'sync' | 'system';

const VALID_TABS: SettingsTab[] = [
  'general',
  'scorer',
  'tailor',
  'observability',
  'scrapers',
  'sync',
  'system',
];

function getInitialTab(): SettingsTab {
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab') as SettingsTab;
      if (tab && VALID_TABS.includes(tab)) return tab;
      const hash = window.location.hash.replace('#', '') as SettingsTab;
      if (hash && VALID_TABS.includes(hash)) return hash;
    } catch {}
  }
  return 'general';
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ settings, onSaveSettings }) => {
  const { user, refreshUser } = useAuth();
  const { colorMode, setColorMode, accentTheme, setAccentTheme } = useTheme();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<SettingsTab>(getInitialTab);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', tab);
        window.history.replaceState({}, '', url.toString());
      } catch {}
    }
  };

  // Extension settings state
  const [extensionConfig, setExtensionConfig] = useState<ExtensionConfig>({
    scanIntervalHours: 6,
    passiveMode: true,
    activeMode: false,
    activeModeDelayMs: 2000,
    maxPostingAgeDays: 30,
    titleFilter: {
      positive: [],
      negative: ['word:intern', 'junior', '.net', 'php', 'wordpress', 'embedded', 'firmware'],
    },
    locationFilter: {
      allow: ['remote', 'worldwide', 'anywhere'],
      block: [],
    },
    portals: {},
    trackedCompanies: [],
  });
  const [savingScrapers, setSavingScrapers] = useState(false);
  const [extractingResume, setExtractingResume] = useState(false);

  // System settings state
  const [formSettings, setFormSettings] = useState<SystemSettings>({
    scorer_model: 'openrouter/google/gemini-2.0-flash-exp:free',
    scorer_provider: 'openrouter',
    scorer_api_key: '',
    scorer_api_base: '',
    scorer_threshold: settings.threshold || 75,
    worker_enabled: true,
    worker_poll_interval_seconds: 10,
    tailor_model: 'openrouter/google/gemini-2.0-flash-exp:free',
    tailor_api_key: '',
    tailor_api_base: '',
    tailor_theme: 'jsonresume-theme-folio',
    tailor_timeout_seconds: 900,
    opik_enabled: false,
    opik_project_name: 'jobfoundry',
    opik_api_key: '',
    opik_workspace: '',
    opik_url_override: '',
    theme_color_mode: colorMode,
    theme_accent: accentTheme,
  });

  const [meta, setMeta] = useState<Record<string, SettingMeta>>({});
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [tempColorMode, setTempColorMode] = useState<ColorMode>(colorMode);
  const [tempAccentTheme, setTempAccentTheme] = useState<AccentTheme>(accentTheme);

  // Secret editing toggles
  const [editingScorerKey, setEditingScorerKey] = useState(false);
  const [newScorerKey, setNewScorerKey] = useState('');
  const [editingTailorKey, setEditingTailorKey] = useState(false);
  const [newTailorKey, setNewTailorKey] = useState('');
  const [editingOpikKey, setEditingOpikKey] = useState(false);
  const [newOpikKey, setNewOpikKey] = useState('');

  // LLM Test Connection State
  const [testingLlm, setTestingLlm] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message?: string;
    error?: string;
    latencyMs?: number;
  } | null>(null);

  // Copy & Rotate state
  const [copiedApiKey, setCopiedApiKey] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Fetch backend settings & telemetry once on mount
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [settingsRes, diagRes, extRes] = await Promise.allSettled([
          api.getSettings(),
          api.getDiagnostics(),
          api.getExtensionConfig(),
        ]);

        if (settingsRes.status === 'fulfilled') {
          const { settings: backendSettings, meta: backendMeta } = settingsRes.value;
          setFormSettings((prev) => ({
            ...prev,
            ...backendSettings,
          }));
          setMeta(backendMeta);
        }

        if (diagRes.status === 'fulfilled') {
          setDiagnostics(diagRes.value);
        }

        if (extRes.status === 'fulfilled') {
          setExtensionConfig(extRes.value);
        }
      } catch (err: any) {
        toast.error(`Failed to load system settings: ${err?.message || 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    }

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFieldChange = (key: keyof SystemSettings, val: any) => {
    setFormSettings((prev) => ({ ...prev, [key]: val }));
    setIsDirty(true);
  };

  const handleSaveExtensionConfig = async () => {
    setSavingScrapers(true);
    try {
      const res = await api.updateExtensionConfig(extensionConfig);
      if (res.config) {
        setExtensionConfig(res.config);
      }
      toast.success('Scrapers and search filters saved successfully');
    } catch (err: any) {
      toast.error(`Failed to save scrapers config: ${err?.message || 'Unknown error'}`);
    } finally {
      setSavingScrapers(false);
    }
  };

  const handleExtractFromResume = async () => {
    setExtractingResume(true);
    try {
      const activeResume = await api.getActiveResume();
      if (!activeResume?.resume) {
        toast.error('No active master resume found. Please upload or activate a resume first.');
        return;
      }
      const titles = extractKeywordsFromResume(activeResume.resume);
      if (titles.length === 0) {
        toast.info('No role keywords detected in active resume.');
        return;
      }
      const existing = extensionConfig.titleFilter?.positive || [];
      const combined = Array.from(new Set([...existing, ...titles]));
      setExtensionConfig((prev) => ({
        ...prev,
        titleFilter: {
          ...prev.titleFilter,
          positive: combined,
        },
      }));
      toast.success(`Fetched ${titles.length} role keyword(s) from master resume`);
    } catch (err: any) {
      toast.error(`Failed to fetch resume keywords: ${err?.message || 'Unknown error'}`);
    } finally {
      setExtractingResume(false);
    }
  };

  const handleSaveAll = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const payload: Partial<SystemSettings> = {
        ...formSettings,
        scorer_threshold: Number(formSettings.scorer_threshold) || 75,
        tailor_timeout_seconds: Number(formSettings.tailor_timeout_seconds) || 900,
        worker_poll_interval_seconds: Number(formSettings.worker_poll_interval_seconds) || 10,
        theme_color_mode: tempColorMode,
        theme_accent: tempAccentTheme,
      };

      if (editingScorerKey && newScorerKey.trim()) {
        payload.scorer_api_key = newScorerKey.trim();
      }
      if (editingTailorKey && newTailorKey.trim()) {
        payload.tailor_api_key = newTailorKey.trim();
      }
      if (editingOpikKey && newOpikKey.trim()) {
        payload.opik_api_key = newOpikKey.trim();
      }

      const [updated] = await Promise.all([
        api.updateSettings(payload),
        api.updateExtensionConfig(extensionConfig).catch(() => null),
      ]);
      setFormSettings((prev) => ({ ...prev, ...updated.settings }));
      setMeta(updated.meta);

      setEditingScorerKey(false);
      setNewScorerKey('');
      setEditingTailorKey(false);
      setNewTailorKey('');
      setEditingOpikKey(false);
      setNewOpikKey('');

      if (tempColorMode !== colorMode) {
        setColorMode(tempColorMode);
      }
      if (tempAccentTheme !== accentTheme) {
        setAccentTheme(tempAccentTheme);
      }

      onSaveSettings({
        apiKey: settings.apiKey,
        apiUrl: apiUrl.trim(),
        threshold: Number(formSettings.scorer_threshold) || 75,
      });

      setIsDirty(false);
      toast.success('Settings updated and persisted successfully');
    } catch (err: any) {
      toast.error(`Failed to save settings: ${err?.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = () => {
    if (!confirm('Reset all runtime settings to default values?')) return;
    setFormSettings((prev) => ({
      ...prev,
      scorer_model: 'openrouter/google/gemini-2.0-flash-exp:free',
      scorer_threshold: 75,
      tailor_model: 'openrouter/google/gemini-2.0-flash-exp:free',
      tailor_theme: 'jsonresume-theme-folio',
      tailor_timeout_seconds: 900,
      opik_enabled: false,
    }));
    setApiUrl(DEFAULT_SETTINGS.apiUrl);
    setTempColorMode('system');
    setTempAccentTheme('indigo');
    setIsDirty(true);
    toast.info('Settings form reset. Click "Save Changes" to apply.');
  };

  const handleTestLlm = async () => {
    setTestingLlm(true);
    setTestResult(null);
    try {
      const model = formSettings.scorer_model;
      const apiBase = formSettings.scorer_api_base;
      const apiKey = editingScorerKey ? newScorerKey : formSettings.scorer_api_key;
      const res = await api.testLlmConnection({ model, apiBase, apiKey });
      setTestResult(res);
      if (res.success) {
        toast.success(res.message || 'LLM connection successful');
      } else {
        toast.error(res.error || 'LLM connection failed');
      }
    } catch (err: any) {
      const msg = err?.message || 'Connection test failed';
      setTestResult({ success: false, error: msg });
      toast.error(msg);
    } finally {
      setTestingLlm(false);
    }
  };

  const handleCopyApiKey = async () => {
    if (!user?.apiKey) return;
    try {
      await navigator.clipboard.writeText(user.apiKey);
      setCopiedApiKey(true);
      toast.success('Extension API Key copied');
      setTimeout(() => setCopiedApiKey(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleCopyApiUrl = async () => {
    try {
      await navigator.clipboard.writeText(apiUrl);
      setCopiedUrl(true);
      toast.success('Server URL copied');
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleRotateApiKey = async () => {
    if (
      !confirm(
        'Are you sure you want to rotate your extension API key? You will need to re-link your browser extension.'
      )
    ) {
      return;
    }
    setRotating(true);
    try {
      await api.rotateApiKey();
      await refreshUser();
      toast.success('API Key rotated successfully');
    } catch (err: any) {
      toast.error(`Failed to rotate API Key: ${err?.message || 'Unknown error'}`);
    } finally {
      setRotating(false);
    }
  };

  const renderSourceBadge = (key: string) => {
    const itemMeta = meta[key];
    if (!itemMeta) return null;
    if (itemMeta.source === 'user') {
      return (
        <span
          className="badge badge-purple"
          style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}
          title="This is your personal BYOK override, stored per user"
        >
          Your Override
        </span>
      );
    }
    if (itemMeta.source === 'system') {
      return (
        <span
          className="badge badge-primary"
          style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}
          title="This setting is customized and stored in SQLite"
        >
          Database Override
        </span>
      );
    }
    if (itemMeta.source === 'env') {
      return (
        <span
          className="badge badge-blue"
          style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}
          title="Inherited from environment or .env file"
        >
          Inherited (.env)
        </span>
      );
    }
    return (
      <span
        className="badge badge-muted"
        style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}
        title="Using system default value"
      >
        Default
      </span>
    );
  };

  const modelPresets = [
    { label: 'Gemini 2.0 Flash (Free)', id: 'openrouter/google/gemini-2.0-flash-exp:free' },
    { label: 'GLM 5.3 Flash', id: 'openrouter/z-ai/glm-5.3-flash' },
    { label: 'Qwen 3.8 Max', id: 'openrouter/qwen/qwen3.8-max' },
    { label: 'GPT-4o Mini', id: 'openai/gpt-4o-mini' },
    { label: 'Claude 3.5 Sonnet', id: 'anthropic/claude-3.5-sonnet' },
  ];

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.8rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              marginBottom: '0.35rem',
            }}
          >
            <Sliders size={24} style={{ color: 'var(--accent-primary)' }} />
            System & Dashboard Settings
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            Configure runtime AI scoring, resume tailoring models, theme aesthetics, and extension
            pairing.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {isDirty && (
            <span
              className="badge badge-amber animate-pulse"
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <AlertTriangle size={12} /> Unsaved Changes
            </span>
          )}
          <button
            type="button"
            onClick={handleResetToDefaults}
            disabled={saving || loading}
            className="btn btn-secondary btn-sm"
          >
            Reset Defaults
          </button>
          <button
            type="button"
            onClick={() => handleSaveAll()}
            disabled={saving || loading}
            className="btn btn-primary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: '110px' }}
          >
            <CheckCircle2 size={15} />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '0.5rem',
          marginBottom: '1.5rem',
          overflowX: 'auto',
        }}
      >
        <button
          type="button"
          onClick={() => handleTabChange('general')}
          className={`btn btn-sm ${activeTab === 'general' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Palette size={15} /> Appearance & UI
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('scorer')}
          className={`btn btn-sm ${activeTab === 'scorer' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Bot size={15} /> AI Fit Scorer
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('tailor')}
          className={`btn btn-sm ${activeTab === 'tailor' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <FileText size={15} /> AI Resume Tailor
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('observability')}
          className={`btn btn-sm ${activeTab === 'observability' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Activity size={15} /> Observability (Opik)
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('scrapers')}
          className={`btn btn-sm ${activeTab === 'scrapers' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Compass size={15} /> Scrapers & Search Filters
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('sync')}
          className={`btn btn-sm ${activeTab === 'sync' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Key size={15} /> Extension & Auth
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('system')}
          className={`btn btn-sm ${activeTab === 'system' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Database size={15} /> Telemetry & System
        </button>
      </div>

      {loading ? (
        <div
          style={{
            padding: '3rem',
            textAlign: 'center',
            color: 'var(--text-secondary)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <RefreshCw size={24} className="animate-spin" />
          <span>Loading system configuration from backend...</span>
        </div>
      ) : (
        <form onSubmit={handleSaveAll}>
          {/* TAB 1: APPEARANCE & INTERFACE */}
          {activeTab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="stat-card" style={{ padding: '1.5rem' }}>
                <h3
                  style={{
                    fontSize: '1.1rem',
                    fontWeight: 600,
                    marginBottom: '0.35rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Palette size={18} style={{ color: 'var(--accent-primary)' }} />
                  Interface & Theme Aesthetics
                </h3>
                <p
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '1.25rem',
                  }}
                >
                  Select your preferred system color mode and accent theme palette.
                </p>

                {/* Color Mode */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}
                  >
                    Color Mode
                  </label>
                  <div className="mode-selector-group">
                    <button
                      type="button"
                      className={`mode-selector-btn ${tempColorMode === 'system' ? 'active' : ''}`}
                      onClick={() => {
                        setTempColorMode('system');
                        setIsDirty(true);
                      }}
                    >
                      <Laptop size={16} /> Auto (System Match)
                    </button>
                    <button
                      type="button"
                      className={`mode-selector-btn ${tempColorMode === 'dark' ? 'active' : ''}`}
                      onClick={() => {
                        setTempColorMode('dark');
                        setIsDirty(true);
                      }}
                    >
                      <Moon size={16} /> Dark Mode
                    </button>
                    <button
                      type="button"
                      className={`mode-selector-btn ${tempColorMode === 'light' ? 'active' : ''}`}
                      onClick={() => {
                        setTempColorMode('light');
                        setIsDirty(true);
                      }}
                    >
                      <Sun size={16} /> Light Mode
                    </button>
                  </div>
                </div>

                {/* Accent Color */}
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                    }}
                  >
                    Accent Color Palette
                  </label>
                  <div className="accent-selector-group">
                    {ACCENT_THEMES.map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        className={`accent-swatch-btn ${tempAccentTheme === theme.id ? 'active' : ''}`}
                        onClick={() => {
                          setTempAccentTheme(theme.id);
                          setIsDirty(true);
                        }}
                      >
                        <span
                          className="accent-swatch-dot"
                          style={{ background: theme.primaryColor }}
                        />
                        {theme.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Threshold Setting */}
              <div className="stat-card" style={{ padding: '1.5rem' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.35rem',
                  }}
                >
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                    Global Fit Score Qualification Threshold
                  </h3>
                  {renderSourceBadge('scorer_threshold')}
                </div>
                <p
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '1rem',
                  }}
                >
                  Jobs scoring at or above this threshold qualify as &ldquo;Qualified&rdquo; and
                  trigger automatic resume tailoring.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={formSettings.scorer_threshold}
                    onChange={(e) =>
                      handleFieldChange('scorer_threshold', Number(e.target.value) || 0)
                    }
                    style={{ flex: 1, accentColor: 'var(--accent-primary)' }}
                  />
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      minWidth: '80px',
                    }}
                  >
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={formSettings.scorer_threshold}
                      onChange={(e) =>
                        handleFieldChange('scorer_threshold', Number(e.target.value) || 0)
                      }
                      className="input-text"
                      style={{ width: '70px', padding: '0.4rem' }}
                    />
                    <span style={{ fontWeight: 600 }}>%</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AI FIT SCORER */}
          {activeTab === 'scorer' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="stat-card" style={{ padding: '1.5rem' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.35rem',
                  }}
                >
                  <h3
                    style={{
                      fontSize: '1.1rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <Bot size={18} style={{ color: 'var(--accent-primary)' }} />
                    LLM Fit Scorer Configuration
                  </h3>
                  {renderSourceBadge('scorer_model')}
                </div>
                <p
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '1.25rem',
                  }}
                >
                  Configures the AI model used to evaluate ingested jobs against your master resume.
                </p>

                {/* Preset Model Buttons */}
                <div style={{ marginBottom: '1rem' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      marginBottom: '0.4rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Recommended Model Presets
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {modelPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleFieldChange('scorer_model', preset.id)}
                        className={`btn btn-sm ${formSettings.scorer_model === preset.id ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                      >
                        <Sparkles size={12} /> {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Model ID input */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      marginBottom: '0.35rem',
                    }}
                  >
                    Scorer Model Identifier (e.g. openrouter/model or openai/model)
                  </label>
                  <input
                    type="text"
                    value={formSettings.scorer_model}
                    onChange={(e) => handleFieldChange('scorer_model', e.target.value)}
                    className="input-text"
                    placeholder="openrouter/z-ai/glm-5.3-flash"
                    required
                  />
                </div>

                {/* API Base URL */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.35rem',
                    }}
                  >
                    <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                      LLM Endpoint Base URL
                    </label>
                    {renderSourceBadge('scorer_api_base')}
                  </div>
                  <input
                    type="text"
                    value={formSettings.scorer_api_base}
                    onChange={(e) => handleFieldChange('scorer_api_base', e.target.value)}
                    className="input-text"
                    placeholder="https://openrouter.ai/api/v1"
                  />
                  <span
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.25rem',
                      display: 'block',
                    }}
                  >
                    Set the direct provider URL, for example
                    <code>https://openrouter.ai/api/v1</code>.
                  </span>
                </div>

                {/* API Key */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.35rem',
                    }}
                  >
                    <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                      LLM API Key (OpenRouter / OpenAI / Anthropic)
                    </label>
                    {renderSourceBadge('scorer_api_key')}
                  </div>

                  {!editingScorerKey ? (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <div
                        style={{
                          flex: 1,
                          padding: '0.55rem 0.75rem',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-subtle)',
                          fontFamily: 'monospace',
                          fontSize: '0.85rem',
                          color: formSettings.scorer_api_key
                            ? 'var(--text-primary)'
                            : 'var(--text-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <Lock size={14} style={{ color: 'var(--accent-primary)' }} />
                        {formSettings.scorer_api_key || 'No API key configured'}
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingScorerKey(true)}
                        className="btn btn-secondary btn-sm"
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        <Unlock size={14} /> Change Key
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input
                        type="password"
                        value={newScorerKey}
                        onChange={(e) => {
                          setNewScorerKey(e.target.value);
                          setIsDirty(true);
                        }}
                        className="input-text"
                        placeholder="Enter new API key (e.g. sk-or-v1-...)"
                        style={{ flex: 1 }}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEditingScorerKey(false);
                          setNewScorerKey('');
                        }}
                        className="btn btn-secondary btn-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Live Test LLM Connection */}
                <div
                  style={{
                    background: 'rgba(99, 102, 241, 0.05)',
                    border: '1px solid rgba(99, 102, 241, 0.2)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                        Test LLM Connectivity
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Send a minimal 1-token test prompt to verify your model and API key.
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid="test-llm-btn"
                      onClick={handleTestLlm}
                      disabled={testingLlm}
                      className="btn btn-secondary btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      {testingLlm ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" /> Testing...
                        </>
                      ) : (
                        <>
                          <Send size={14} /> Test Connection
                        </>
                      )}
                    </button>
                  </div>

                  {testResult && (
                    <div
                      style={{
                        marginTop: '0.75rem',
                        padding: '0.75rem',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.85rem',
                        background: testResult.success
                          ? 'var(--color-green-bg)'
                          : 'rgba(239, 68, 68, 0.1)',
                        border: `1px solid ${testResult.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                        color: testResult.success ? 'var(--color-green)' : 'var(--color-red)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      {testResult.success ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        <AlertTriangle size={16} />
                      )}
                      <span>{testResult.message || testResult.error}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: AI RESUME TAILOR */}
          {activeTab === 'tailor' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="stat-card" style={{ padding: '1.5rem' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.35rem',
                  }}
                >
                  <h3
                    style={{
                      fontSize: '1.1rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <FileText size={18} style={{ color: 'var(--accent-primary)' }} />
                    Resume Tailoring Engine (resume-ops)
                  </h3>
                  {renderSourceBadge('tailor_model')}
                </div>
                <p
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '1.25rem',
                  }}
                >
                  Controls the AI model that rewrites experience bullets, highlights skills, and
                  compiles tailored PDF resumes.
                </p>

                {/* Tailor Model */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      marginBottom: '0.35rem',
                    }}
                  >
                    Tailoring Model Identifier
                  </label>
                  <input
                    type="text"
                    value={formSettings.tailor_model}
                    onChange={(e) => handleFieldChange('tailor_model', e.target.value)}
                    className="input-text"
                    placeholder="openrouter/qwen/qwen3.8-max"
                  />
                </div>

                {/* Default Resume Theme */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.35rem',
                    }}
                  >
                    <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                      Default Resume Theme
                    </label>
                    {renderSourceBadge('tailor_theme')}
                  </div>
                  <select
                    value={formSettings.tailor_theme}
                    onChange={(e) => handleFieldChange('tailor_theme', e.target.value)}
                    className="input-text"
                  >
                    <option value="jsonresume-theme-folio">
                      Folio (Modern 2-Column Professional)
                    </option>
                    <option value="jsonresume-theme-folio-concise">
                      Folio Concise (Dense 1-Page Format)
                    </option>
                    <option value="jsonresume-theme-stackoverflow">
                      StackOverflow (Clean Developer Theme)
                    </option>
                  </select>
                </div>

                {/* Tailor Timeout */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.35rem',
                    }}
                  >
                    <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                      Tailoring Timeout (Seconds)
                    </label>
                    {renderSourceBadge('tailor_timeout_seconds')}
                  </div>
                  <input
                    type="number"
                    min="60"
                    max="3600"
                    value={formSettings.tailor_timeout_seconds}
                    onChange={(e) =>
                      handleFieldChange('tailor_timeout_seconds', Number(e.target.value) || 900)
                    }
                    className="input-text"
                  />
                  <span
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.25rem',
                      display: 'block',
                    }}
                  >
                    Maximum time to allow multi-stage LLM resume rewriting and Puppeteer PDF
                    rendering (Default: 900s / 15m).
                  </span>
                </div>

                {/* Tailor API Key */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.35rem',
                    }}
                  >
                    <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                      Dedicated Tailor API Key (Optional)
                    </label>
                    {renderSourceBadge('tailor_api_key')}
                  </div>

                  {!editingTailorKey ? (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <div
                        style={{
                          flex: 1,
                          padding: '0.55rem 0.75rem',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-subtle)',
                          fontFamily: 'monospace',
                          fontSize: '0.85rem',
                          color: formSettings.tailor_api_key
                            ? 'var(--text-primary)'
                            : 'var(--text-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <Lock size={14} style={{ color: 'var(--accent-primary)' }} />
                        {formSettings.tailor_api_key || 'Inherited from the configured provider'}
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingTailorKey(true)}
                        className="btn btn-secondary btn-sm"
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        <Unlock size={14} /> Change Key
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input
                        type="password"
                        value={newTailorKey}
                        onChange={(e) => {
                          setNewTailorKey(e.target.value);
                          setIsDirty(true);
                        }}
                        className="input-text"
                        placeholder="Enter custom key for tailor service"
                        style={{ flex: 1 }}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTailorKey(false);
                          setNewTailorKey('');
                        }}
                        className="btn btn-secondary btn-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: OBSERVABILITY & TRACING */}
          {activeTab === 'observability' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="stat-card" style={{ padding: '1.5rem' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.35rem',
                  }}
                >
                  <h3
                    style={{
                      fontSize: '1.1rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <Activity size={18} style={{ color: 'var(--accent-primary)' }} />
                    LLM Observability & Opik Tracing
                  </h3>
                  {renderSourceBadge('opik_project_name')}
                </div>
                <p
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '1.25rem',
                  }}
                >
                  Stream prompt tokens, model latency, and evaluation traces to Comet Opik Cloud or
                  your self-hosted Opik instance.
                </p>

                {/* Opik Enabled Toggle */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    marginBottom: '1.25rem',
                  }}
                >
                  <input
                    type="checkbox"
                    id="opik_enabled"
                    checked={formSettings.opik_enabled}
                    onChange={(e) => handleFieldChange('opik_enabled', e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-primary)' }}
                  />
                  <label
                    htmlFor="opik_enabled"
                    style={{ fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer' }}
                  >
                    Enable Opik Tracing Callbacks
                  </label>
                </div>

                {/* Project Name */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      marginBottom: '0.35rem',
                    }}
                  >
                    Opik Project Name
                  </label>
                  <input
                    type="text"
                    value={formSettings.opik_project_name}
                    onChange={(e) => handleFieldChange('opik_project_name', e.target.value)}
                    className="input-text"
                    placeholder="jobfoundry"
                  />
                </div>

                {/* Opik Workspace */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      marginBottom: '0.35rem',
                    }}
                  >
                    Opik Workspace (Optional)
                  </label>
                  <input
                    type="text"
                    value={formSettings.opik_workspace}
                    onChange={(e) => handleFieldChange('opik_workspace', e.target.value)}
                    className="input-text"
                    placeholder="my-workspace"
                  />
                </div>

                {/* Opik API Key */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.35rem',
                    }}
                  >
                    <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>Opik API Key</label>
                    {renderSourceBadge('opik_api_key')}
                  </div>

                  {!editingOpikKey ? (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <div
                        style={{
                          flex: 1,
                          padding: '0.55rem 0.75rem',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-subtle)',
                          fontFamily: 'monospace',
                          fontSize: '0.85rem',
                          color: formSettings.opik_api_key
                            ? 'var(--text-primary)'
                            : 'var(--text-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <Lock size={14} style={{ color: 'var(--accent-primary)' }} />
                        {formSettings.opik_api_key || 'No Opik key configured'}
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingOpikKey(true)}
                        className="btn btn-secondary btn-sm"
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        <Unlock size={14} /> Change Key
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input
                        type="password"
                        value={newOpikKey}
                        onChange={(e) => {
                          setNewOpikKey(e.target.value);
                          setIsDirty(true);
                        }}
                        className="input-text"
                        placeholder="Enter Opik API Key"
                        style={{ flex: 1 }}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEditingOpikKey(false);
                          setNewOpikKey('');
                        }}
                        className="btn btn-secondary btn-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Opik Self-Hosted URL */}
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      marginBottom: '0.35rem',
                    }}
                  >
                    Opik Custom URL Override (For Self-Hosted Opik)
                  </label>
                  <input
                    type="text"
                    value={formSettings.opik_url_override}
                    onChange={(e) => handleFieldChange('opik_url_override', e.target.value)}
                    className="input-text"
                    placeholder="http://localhost:5173/api"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: EXTENSION & AUTH */}
          {activeTab === 'sync' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* User Account Info */}
              {user && (
                <div
                  className="stat-card"
                  style={{
                    background: 'rgba(99, 102, 241, 0.08)',
                    border: '1px solid rgba(99, 102, 241, 0.25)',
                    padding: '1.5rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '1rem',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                        {user.name || user.email}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {user.email}
                      </div>
                    </div>
                    <span className="badge badge-primary">Active Account</span>
                  </div>

                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        marginBottom: '0.35rem',
                      }}
                    >
                      Browser Extension Pairing Key
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        readOnly
                        value={user.apiKey || 'No key generated'}
                        className="input-text"
                        style={{
                          fontSize: '0.85rem',
                          fontFamily: 'monospace',
                          paddingLeft: '0.75rem',
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleCopyApiKey}
                        className="btn btn-secondary btn-sm"
                        style={{
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                        }}
                      >
                        <Copy size={14} />
                        {copiedApiKey ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={handleRotateApiKey}
                        disabled={rotating}
                        className="btn btn-secondary btn-sm"
                        title="Rotate API Key"
                      >
                        <RefreshCw size={14} className={rotating ? 'animate-spin' : ''} />
                      </button>
                    </div>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        marginTop: '0.35rem',
                        display: 'block',
                      }}
                    >
                      Paste this key into your JobFoundry browser extension to synchronize captured
                      jobs.
                    </span>
                  </div>
                </div>
              )}

              {/* Ingest Server URL */}
              <div className="stat-card" style={{ padding: '1.5rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Ingest & Server API Endpoint
                </h3>
                <p
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '1rem',
                  }}
                >
                  The base URL used by your browser dashboard and extension to communicate with the
                  backend.
                </p>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={apiUrl}
                    onChange={(e) => {
                      setApiUrl(e.target.value);
                      setIsDirty(true);
                    }}
                    placeholder="http://localhost:8080"
                    className="input-text"
                    required
                  />
                  <button
                    type="button"
                    onClick={handleCopyApiUrl}
                    className="btn btn-secondary btn-sm"
                    style={{
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <Copy size={14} />
                    {copiedUrl ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB: SCRAPERS & SEARCH FILTERS */}
          {activeTab === 'scrapers' && (
            <ScraperSettingsTab
              config={extensionConfig}
              onChange={setExtensionConfig}
              onSave={handleSaveExtensionConfig}
              saving={savingScrapers}
              onExtractFromResume={handleExtractFromResume}
              extractingResume={extractingResume}
            />
          )}

          {/* TAB 6: TELEMETRY & SYSTEM */}
          {activeTab === 'system' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="stat-card" style={{ padding: '1.5rem' }}>
                <h3
                  style={{
                    fontSize: '1.1rem',
                    fontWeight: 600,
                    marginBottom: '0.35rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Database size={18} style={{ color: 'var(--accent-primary)' }} />
                  System Diagnostics & Architecture
                </h3>
                <p
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '1.25rem',
                  }}
                >
                  Live operational metrics from the running container services.
                </p>

                {diagnostics ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: '1rem',
                      marginBottom: '1.5rem',
                    }}
                  >
                    <div
                      style={{
                        padding: '1rem',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-secondary)',
                      }}
                    >
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Status</div>
                      <div
                        style={{
                          fontSize: '1.2rem',
                          fontWeight: 700,
                          color: 'var(--color-green)',
                        }}
                      >
                        ● {diagnostics.status}
                      </div>
                    </div>
                    <div
                      style={{
                        padding: '1rem',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-secondary)',
                      }}
                    >
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Server Uptime
                      </div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                        {Math.floor(diagnostics.uptime / 60)}m {Math.floor(diagnostics.uptime % 60)}
                        s
                      </div>
                    </div>
                    <div
                      style={{
                        padding: '1rem',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-secondary)',
                      }}
                    >
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Total Jobs in DB
                      </div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                        {diagnostics.database.totalJobs}
                      </div>
                    </div>
                    <div
                      style={{
                        padding: '1rem',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-secondary)',
                      }}
                    >
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Node Environment
                      </div>
                      <div style={{ fontSize: '1rem', fontWeight: 600 }}>
                        {diagnostics.environment.nodeVersion} ({diagnostics.environment.platform})
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                    Diagnostics unavailable.
                  </div>
                )}

                {/* Storage & Volume Paths */}
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                    Container Storage Mounts & Fallbacks
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.85rem',
                      }}
                    >
                      <span style={{ color: 'var(--text-secondary)' }}>SQLite Database Path:</span>
                      <code>/data/jobfoundry.db</code>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.85rem',
                      }}
                    >
                      <span style={{ color: 'var(--text-secondary)' }}>
                        Artifacts Storage Path:
                      </span>
                      <code>/data/artifacts</code>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.85rem',
                      }}
                    >
                      <span style={{ color: 'var(--text-secondary)' }}>LLM provider endpoint:</span>
                      <code>{formSettings.scorer_api_base || 'Not configured'}</code>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Save Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              marginTop: '2rem',
              paddingTop: '1.5rem',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <button
              type="button"
              onClick={handleResetToDefaults}
              disabled={saving}
              className="btn btn-secondary btn-sm"
            >
              Reset Defaults
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn btn-primary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: '120px' }}
            >
              <CheckCircle2 size={15} />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
