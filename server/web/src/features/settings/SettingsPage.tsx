import React, { useState, useEffect } from 'react';
import { AppSettings, DEFAULT_SETTINGS } from '../../lib/auth';
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
import { ResumeManager } from '../resume/ResumeManager';
import { ExtensionSyncView } from '../sync/ExtensionSyncView';
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
  Sliders,
  Send,
  Lock,
  Unlock,
  Compass,
  Zap,
  Sparkles,
  ChevronRight,
  Check,
} from 'lucide-react';
import { LLM_PROVIDERS, detectProviderFromModel, ALL_RECOMMENDED_MODELS } from './llmCatalog';

interface SettingsPageProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
}

type SettingsTab =
  'profile' | 'general' | 'scorer' | 'tailor' | 'observability' | 'scrapers' | 'sync' | 'system';

const VALID_TABS: SettingsTab[] = [
  'profile',
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
  const [extensionLoaded, setExtensionLoaded] = useState(false);
  const [isExtensionDirty, setIsExtensionDirty] = useState(false);
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

  // LLM Provider & Multi-Model Selection State
  const [selectedScorerProvider, setSelectedScorerProvider] = useState<string>(() => {
    return (
      formSettings.scorer_provider ||
      detectProviderFromModel(formSettings.scorer_model) ||
      'openrouter'
    );
  });
  const [showScorerEndpointOverride, setShowScorerEndpointOverride] = useState<boolean>(false);

  const [tailorSyncWithScorer, setTailorSyncWithScorer] = useState<boolean>(true);
  const [selectedTailorProvider, setSelectedTailorProvider] = useState<string>(() => {
    return detectProviderFromModel(formSettings.tailor_model) || 'openrouter';
  });
  const [showTailorEndpointOverride, setShowTailorEndpointOverride] = useState<boolean>(false);

  // LLM Test Connection State
  const [testingLlm, setTestingLlm] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message?: string;
    error?: string;
    latencyMs?: number;
  } | null>(null);

  const [testingTailorLlm, setTestingTailorLlm] = useState(false);
  const [tailorTestResult, setTailorTestResult] = useState<{
    success: boolean;
    message?: string;
    error?: string;
    latencyMs?: number;
  } | null>(null);

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

          if (backendSettings.scorer_provider) {
            setSelectedScorerProvider(backendSettings.scorer_provider);
          } else if (backendSettings.scorer_model) {
            setSelectedScorerProvider(detectProviderFromModel(backendSettings.scorer_model));
          }
          if (backendSettings.scorer_api_base) {
            setShowScorerEndpointOverride(true);
          }
          if (backendSettings.tailor_model) {
            setSelectedTailorProvider(detectProviderFromModel(backendSettings.tailor_model));
          }
          if (backendSettings.tailor_api_base) {
            setShowTailorEndpointOverride(true);
          }
          if (
            backendSettings.tailor_api_key &&
            backendSettings.scorer_api_key &&
            backendSettings.tailor_api_key !== backendSettings.scorer_api_key
          ) {
            setTailorSyncWithScorer(false);
          }
        }

        if (diagRes.status === 'fulfilled') {
          setDiagnostics(diagRes.value);
        }

        if (extRes.status === 'fulfilled') {
          setExtensionConfig(extRes.value);
          setExtensionLoaded(true);
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

  const handleSelectScorerProvider = (providerId: string) => {
    setSelectedScorerProvider(providerId);
    handleFieldChange('scorer_provider', providerId);
    const providerMeta = LLM_PROVIDERS.find((p) => p.id === providerId);
    if (providerMeta?.isLocal || providerMeta?.isCustom) {
      setShowScorerEndpointOverride(true);
      if (!formSettings.scorer_api_base && providerMeta.defaultBase) {
        handleFieldChange('scorer_api_base', providerMeta.defaultBase);
      }
    } else {
      if (
        formSettings.scorer_api_base?.includes('11434') ||
        formSettings.scorer_api_base?.includes('localhost:8000')
      ) {
        handleFieldChange('scorer_api_base', '');
      }
    }
  };

  const handleSelectTailorProvider = (providerId: string) => {
    setSelectedTailorProvider(providerId);
    const providerMeta = LLM_PROVIDERS.find((p) => p.id === providerId);
    if (providerMeta?.isLocal || providerMeta?.isCustom) {
      setShowTailorEndpointOverride(true);
      if (!formSettings.tailor_api_base && providerMeta.defaultBase) {
        handleFieldChange('tailor_api_base', providerMeta.defaultBase);
      }
    } else {
      if (
        formSettings.tailor_api_base?.includes('11434') ||
        formSettings.tailor_api_base?.includes('localhost:8000')
      ) {
        handleFieldChange('tailor_api_base', '');
      }
    }
  };

  const handleFieldChange = (key: keyof SystemSettings, val: any) => {
    setFormSettings((prev) => ({ ...prev, [key]: val }));
    setIsDirty(true);
  };

  const handleExtensionChange = (updated: ExtensionConfig) => {
    setExtensionConfig(updated);
    setIsExtensionDirty(true);
    setIsDirty(true);
  };

  const handleSaveExtensionConfig = async () => {
    setSavingScrapers(true);
    try {
      const res = await api.updateExtensionConfig(extensionConfig);
      if (res.config) {
        setExtensionConfig(res.config);
      }
      setIsExtensionDirty(false);
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
      setIsExtensionDirty(true);
      setIsDirty(true);
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
        scorer_provider: selectedScorerProvider,
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

      if (tailorSyncWithScorer) {
        if (payload.scorer_api_key) {
          payload.tailor_api_key = payload.scorer_api_key;
        }
        payload.tailor_api_base = formSettings.scorer_api_base;
      }

      const savePromises: Promise<any>[] = [api.updateSettings(payload)];
      const savingExtension = Boolean(isExtensionDirty && extensionLoaded);
      if (savingExtension) {
        savePromises.push(api.updateExtensionConfig(extensionConfig));
      }

      const [updated, extRes] = await Promise.all(savePromises);
      if (savingExtension) {
        if (extRes?.config) {
          setExtensionConfig(extRes.config);
        }
        setIsExtensionDirty(false);
      }
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

  const handleTestLlm = async (service: 'scorer' | 'tailor' = 'scorer') => {
    if (service === 'scorer') {
      setTestingLlm(true);
      setTestResult(null);
      try {
        const model = formSettings.scorer_model;
        const apiBase = formSettings.scorer_api_base;
        const apiKey = editingScorerKey ? newScorerKey : formSettings.scorer_api_key;
        const provider = selectedScorerProvider;
        const res = await api.testLlmConnection({ model, apiBase, apiKey, provider });
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
    } else {
      setTestingTailorLlm(true);
      setTailorTestResult(null);
      try {
        const model = formSettings.tailor_model;
        const apiBase = tailorSyncWithScorer
          ? formSettings.scorer_api_base
          : formSettings.tailor_api_base;
        const apiKey = tailorSyncWithScorer
          ? editingScorerKey
            ? newScorerKey
            : formSettings.scorer_api_key
          : editingTailorKey
            ? newTailorKey
            : formSettings.tailor_api_key;
        const provider = tailorSyncWithScorer ? selectedScorerProvider : selectedTailorProvider;
        const res = await api.testLlmConnection({ model, apiBase, apiKey, provider });
        setTailorTestResult(res);
        if (res.success) {
          toast.success(res.message || 'Tailoring model connection successful');
        } else {
          toast.error(res.error || 'Tailoring model connection failed');
        }
      } catch (err: any) {
        const msg = err?.message || 'Connection test failed';
        setTailorTestResult({ success: false, error: msg });
        toast.error(msg);
      } finally {
        setTestingTailorLlm(false);
      }
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

  return (
    <div className="settings-container">
      {/* Page Header */}
      <div className="settings-header">
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
            Configure runtime AI scoring, master profile, resume tailoring models, and ingestion
            filters.
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

      <div className="settings-layout">
        {/* Left Sidebar Navigation */}
        <aside className="settings-sidebar">
          {/* GROUP 1: PREFERENCES */}
          <div className="settings-nav-group">
            <div className="settings-nav-group-title">Preferences</div>
            <button
              type="button"
              onClick={() => handleTabChange('profile')}
              className={`settings-nav-item ${activeTab === 'profile' ? 'active' : ''}`}
            >
              <FileText size={16} /> Master Profile
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('general')}
              className={`settings-nav-item ${activeTab === 'general' ? 'active' : ''}`}
            >
              <Palette size={16} /> Appearance & UI
            </button>
          </div>

          {/* GROUP 2: AI ENGINES */}
          <div className="settings-nav-group">
            <div className="settings-nav-group-title">AI Engines</div>
            <button
              type="button"
              onClick={() => handleTabChange('scorer')}
              className={`settings-nav-item ${activeTab === 'scorer' ? 'active' : ''}`}
            >
              <Bot size={16} /> AI Fit Scorer
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('tailor')}
              className={`settings-nav-item ${activeTab === 'tailor' ? 'active' : ''}`}
            >
              <Sliders size={16} /> AI Resume Tailor
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('observability')}
              className={`settings-nav-item ${activeTab === 'observability' ? 'active' : ''}`}
            >
              <Activity size={16} /> Observability (Opik)
            </button>
          </div>

          {/* GROUP 3: INGESTION & DATA */}
          <div className="settings-nav-group">
            <div className="settings-nav-group-title">Ingestion & Data</div>
            <button
              type="button"
              onClick={() => handleTabChange('scrapers')}
              className={`settings-nav-item ${activeTab === 'scrapers' ? 'active' : ''}`}
            >
              <Compass size={16} /> Scrapers & Search Filters
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('sync')}
              className={`settings-nav-item ${activeTab === 'sync' ? 'active' : ''}`}
            >
              <Key size={16} /> Extension & Auth
            </button>
          </div>

          {/* GROUP 4: SYSTEM */}
          <div className="settings-nav-group">
            <div className="settings-nav-group-title">System</div>
            <button
              type="button"
              onClick={() => handleTabChange('system')}
              className={`settings-nav-item ${activeTab === 'system' ? 'active' : ''}`}
            >
              <Database size={16} /> Telemetry & System
            </button>
          </div>
        </aside>

        {/* Right Content Area */}
        <div className="settings-content">
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
              {/* TAB 0: MASTER PROFILE */}
              {activeTab === 'profile' && (
                <div className="settings-card" style={{ padding: '1.5rem' }}>
                  <ResumeManager />
                </div>
              )}

              {/* TAB 1: APPEARANCE & INTERFACE */}
              {activeTab === 'general' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="settings-card" style={{ padding: '1.5rem' }}>
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
                  <div className="settings-card" style={{ padding: '1.5rem' }}>
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
                  <div className="settings-card" style={{ padding: '1.5rem' }}>
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
                      Configures the primary AI model used to evaluate ingested jobs against your
                      master resume. LiteLLM handles automated routing across 152+ providers.
                    </p>

                    {/* Primary Provider Selector */}
                    <div style={{ marginBottom: '1.25rem' }}>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          marginBottom: '0.5rem',
                        }}
                      >
                        Primary LLM Provider
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {LLM_PROVIDERS.map((p) => {
                          const isSelected = selectedScorerProvider === p.id;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => handleSelectScorerProvider(p.id)}
                              style={{
                                padding: '0.4rem 0.75rem',
                                borderRadius: 'var(--radius-md)',
                                fontSize: '0.82rem',
                                fontWeight: isSelected ? 600 : 400,
                                border: isSelected
                                  ? '1.5px solid var(--accent-primary)'
                                  : '1px solid var(--border-subtle)',
                                background: isSelected
                                  ? 'rgba(99, 102, 241, 0.12)'
                                  : 'var(--bg-card)',
                                color: isSelected
                                  ? 'var(--accent-primary)'
                                  : 'var(--text-secondary)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {p.isLocal && (
                                <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>🏠</span>
                              )}
                              {p.name}
                              {isSelected && <Check size={13} style={{ strokeWidth: 3 }} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Recommended Fast Models */}
                    {(() => {
                      const providerMeta =
                        LLM_PROVIDERS.find((p) => p.id === selectedScorerProvider) ||
                        LLM_PROVIDERS[0];
                      const fastModels = providerMeta.recommendedModels.filter(
                        (m) => m.tier === 'fast'
                      );
                      const isFallback = fastModels.length === 0;
                      const modelsToShow = !isFallback
                        ? fastModels
                        : LLM_PROVIDERS.flatMap((p) => p.recommendedModels)
                            .filter((m) => m.tier === 'fast')
                            .slice(0, 4);

                      return (
                        <div
                          style={{
                            marginBottom: '1.25rem',
                            padding: '0.75rem',
                            background: 'var(--bg-input, rgba(255,255,255,0.02))',
                            border: '1px dashed var(--border-subtle)',
                            borderRadius: 'var(--radius-md)',
                          }}
                        >
                          <div
                            style={{
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              color: 'var(--text-secondary)',
                              marginBottom: '0.5rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                            }}
                          >
                            <Zap size={14} style={{ color: 'var(--accent-primary)' }} />
                            {isFallback
                              ? 'Recommended Fast Screening Models (other providers):'
                              : `Recommended Fast Screening Models (${providerMeta.name}):`}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {modelsToShow.map((m) => {
                              const isCurrent = formSettings.scorer_model === m.id;
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => {
                                    handleFieldChange('scorer_model', m.id);
                                    setIsDirty(true);
                                  }}
                                  style={{
                                    padding: '0.35rem 0.65rem',
                                    borderRadius: 'var(--radius-sm)',
                                    fontSize: '0.78rem',
                                    border: isCurrent
                                      ? '1px solid var(--accent-primary)'
                                      : '1px solid var(--border-subtle)',
                                    background: isCurrent
                                      ? 'rgba(99, 102, 241, 0.15)'
                                      : 'var(--bg-card)',
                                    color: isCurrent
                                      ? 'var(--accent-primary)'
                                      : 'var(--text-primary)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.35rem',
                                  }}
                                  title={m.description}
                                >
                                  <span>{m.name}</span>
                                  <span
                                    style={{
                                      fontSize: '0.7rem',
                                      padding: '0.1rem 0.35rem',
                                      borderRadius: '3px',
                                      background: isCurrent
                                        ? 'var(--accent-primary)'
                                        : 'var(--border-subtle)',
                                      color: isCurrent ? '#fff' : 'var(--text-muted)',
                                    }}
                                  >
                                    Fast
                                  </span>
                                  {isCurrent && <Check size={12} />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Model ID input + datalist */}
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
                          Scorer Model Identifier (e.g. openrouter/model or openai/model)
                        </label>
                      </div>
                      <input
                        type="text"
                        list="scorer-model-suggestions"
                        value={formSettings.scorer_model}
                        onChange={(e) => {
                          const val = e.target.value;
                          handleFieldChange('scorer_model', val);
                          const current = LLM_PROVIDERS.find(
                            (p) => p.id === selectedScorerProvider
                          );
                          const hasKnownPrefix = LLM_PROVIDERS.some((p) =>
                            val.toLowerCase().startsWith(`${p.id}/`)
                          );
                          const detected = detectProviderFromModel(val);
                          if (
                            hasKnownPrefix &&
                            !current?.isCustom &&
                            !current?.isLocal &&
                            detected !== selectedScorerProvider
                          ) {
                            setSelectedScorerProvider(detected);
                            handleFieldChange('scorer_provider', detected);
                          }
                        }}
                        className="input-text"
                        placeholder="openrouter/z-ai/glm-5.3-flash"
                        required
                      />
                      <datalist id="scorer-model-suggestions">
                        {ALL_RECOMMENDED_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.provider}) - {m.description}
                          </option>
                        ))}
                      </datalist>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          marginTop: '0.25rem',
                          display: 'block',
                        }}
                      >
                        LiteLLM supports 2,500+ models. Select from quick recommendations or type
                        any valid model identifier.
                      </span>
                    </div>

                    {/* API Key */}
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
                          {(() => {
                            const p = LLM_PROVIDERS.find((x) => x.id === selectedScorerProvider);
                            return `${p?.name || 'LLM'} API Key`;
                          })()}
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
                            placeholder={
                              LLM_PROVIDERS.find((x) => x.id === selectedScorerProvider)
                                ?.keyPlaceholder || 'Enter API key (e.g. sk-...)'
                            }
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
                      <span
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          marginTop: '0.25rem',
                          display: 'block',
                        }}
                      >
                        {LLM_PROVIDERS.find((x) => x.id === selectedScorerProvider)?.keyHelp ||
                          'Your API key is securely encrypted and stored locally.'}
                      </span>
                    </div>

                    {/* Endpoint Base URL (Smart Toggle / Override) */}
                    {(() => {
                      const p = LLM_PROVIDERS.find((x) => x.id === selectedScorerProvider);
                      const requiresBaseUrl = Boolean(p?.isLocal || p?.isCustom);
                      const isShowing =
                        requiresBaseUrl ||
                        showScorerEndpointOverride ||
                        Boolean(formSettings.scorer_api_base);

                      if (isShowing) {
                        return (
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
                                LLM Endpoint Base URL {requiresBaseUrl ? '' : '(Custom Override)'}
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {!requiresBaseUrl && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowScorerEndpointOverride(false);
                                      handleFieldChange('scorer_api_base', '');
                                    }}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: 'var(--text-muted)',
                                      fontSize: '0.75rem',
                                      cursor: 'pointer',
                                      textDecoration: 'underline',
                                    }}
                                  >
                                    Reset to Default Route
                                  </button>
                                )}
                                {renderSourceBadge('scorer_api_base')}
                              </div>
                            </div>
                            <input
                              type="text"
                              value={formSettings.scorer_api_base}
                              onChange={(e) => handleFieldChange('scorer_api_base', e.target.value)}
                              className="input-text"
                              placeholder={p?.defaultBase || 'https://openrouter.ai/api/v1'}
                            />
                            <span
                              style={{
                                fontSize: '0.75rem',
                                color: 'var(--text-muted)',
                                marginTop: '0.25rem',
                                display: 'block',
                              }}
                            >
                              {requiresBaseUrl
                                ? 'Local/Gateway endpoints (e.g. http://localhost:11434 for Ollama).'
                                : 'Cloud providers route automatically; custom base URL is only needed for private reverse proxies or gateways.'}
                            </span>
                          </div>
                        );
                      }

                      return (
                        <div style={{ marginBottom: '1.5rem' }}>
                          <button
                            type="button"
                            onClick={() => setShowScorerEndpointOverride(true)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--accent-primary)',
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              padding: '0.2rem 0',
                            }}
                          >
                            <ChevronRight size={14} /> Advanced: Custom Endpoint Base URL / Proxy
                          </button>
                        </div>
                      );
                    })()}

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
                            Send a minimal 1-token test prompt via LiteLLM to verify model routing
                            and credentials.
                          </div>
                        </div>
                        <button
                          type="button"
                          data-testid="test-llm-btn"
                          onClick={() => handleTestLlm('scorer')}
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
                          <span>
                            {testResult.message || testResult.error}
                            {testResult.latencyMs !== undefined
                              ? ` (${testResult.latencyMs}ms)`
                              : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: AI RESUME TAILOR */}
              {activeTab === 'tailor' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="settings-card" style={{ padding: '1.5rem' }}>
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

                    {/* Sync toggle with AI Fit Scorer */}
                    <div
                      style={{
                        marginBottom: '1.25rem',
                        padding: '0.85rem 1rem',
                        borderRadius: 'var(--radius-md)',
                        background: tailorSyncWithScorer
                          ? 'rgba(99, 102, 241, 0.08)'
                          : 'var(--bg-input)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.65rem',
                          cursor: 'pointer',
                          fontSize: '0.88rem',
                          fontWeight: 600,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={tailorSyncWithScorer}
                          onChange={(e) => {
                            setTailorSyncWithScorer(e.target.checked);
                            setIsDirty(true);
                          }}
                          style={{
                            accentColor: 'var(--accent-primary)',
                            width: '16px',
                            height: '16px',
                          }}
                        />
                        Use same provider & API key as AI Fit Scorer (Recommended)
                      </label>
                      <div
                        style={{
                          fontSize: '0.78rem',
                          color: 'var(--text-muted)',
                          marginTop: '0.35rem',
                          marginLeft: '1.65rem',
                        }}
                      >
                        {tailorSyncWithScorer
                          ? `Inheriting provider (${LLM_PROVIDERS.find((p) => p.id === selectedScorerProvider)?.name || 'Primary'}) and credentials from AI Fit Scorer. Both services share the same gateway.`
                          : 'Configure independent provider credentials specifically for high-capacity resume tailoring.'}
                      </div>
                    </div>

                    {/* If NOT synced, show dedicated provider selector & key */}
                    {!tailorSyncWithScorer && (
                      <div
                        style={{
                          marginBottom: '1.25rem',
                          padding: '1rem',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-md)',
                        }}
                      >
                        <div style={{ marginBottom: '1rem' }}>
                          <label
                            style={{
                              display: 'block',
                              fontSize: '0.85rem',
                              fontWeight: 600,
                              marginBottom: '0.5rem',
                            }}
                          >
                            Tailor Dedicated Provider
                          </label>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                            {LLM_PROVIDERS.map((p) => {
                              const isSelected = selectedTailorProvider === p.id;
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => handleSelectTailorProvider(p.id)}
                                  style={{
                                    padding: '0.35rem 0.65rem',
                                    borderRadius: 'var(--radius-md)',
                                    fontSize: '0.8rem',
                                    fontWeight: isSelected ? 600 : 400,
                                    border: isSelected
                                      ? '1.5px solid var(--accent-primary)'
                                      : '1px solid var(--border-subtle)',
                                    background: isSelected
                                      ? 'rgba(99, 102, 241, 0.12)'
                                      : 'var(--bg-card)',
                                    color: isSelected
                                      ? 'var(--accent-primary)'
                                      : 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.35rem',
                                  }}
                                >
                                  {p.name}
                                  {isSelected && <Check size={12} />}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Dedicated Tailor Key */}
                        <div style={{ marginBottom: '1rem' }}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '0.35rem',
                            }}
                          >
                            <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                              Dedicated Tailor API Key
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
                                {formSettings.tailor_api_key || 'No dedicated key set'}
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditingTailorKey(true)}
                                className="btn btn-secondary btn-sm"
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

                        {/* Tailor Base URL */}
                        {(() => {
                          const p = LLM_PROVIDERS.find((x) => x.id === selectedTailorProvider);
                          const requiresBase = Boolean(p?.isLocal || p?.isCustom);
                          if (
                            requiresBase ||
                            showTailorEndpointOverride ||
                            Boolean(formSettings.tailor_api_base)
                          ) {
                            return (
                              <div>
                                <label
                                  style={{
                                    fontSize: '0.85rem',
                                    fontWeight: 500,
                                    display: 'block',
                                    marginBottom: '0.35rem',
                                  }}
                                >
                                  Dedicated Endpoint Base URL
                                </label>
                                <input
                                  type="text"
                                  value={formSettings.tailor_api_base}
                                  onChange={(e) =>
                                    handleFieldChange('tailor_api_base', e.target.value)
                                  }
                                  className="input-text"
                                  placeholder={p?.defaultBase || 'https://api.openai.com/v1'}
                                />
                              </div>
                            );
                          }
                          return (
                            <button
                              type="button"
                              onClick={() => setShowTailorEndpointOverride(true)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--accent-primary)',
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                              }}
                            >
                              <ChevronRight size={14} /> Custom Tailor Base URL (Optional)
                            </button>
                          );
                        })()}
                      </div>
                    )}

                    {/* Recommended Tailoring & Reasoning Models */}
                    {(() => {
                      const effectiveProvider = tailorSyncWithScorer
                        ? selectedScorerProvider
                        : selectedTailorProvider;
                      const providerMeta = LLM_PROVIDERS.find((p) => p.id === effectiveProvider);
                      const reasoningModels =
                        providerMeta?.recommendedModels.filter((m) => m.tier === 'reasoning') || [];
                      const isFallback = reasoningModels.length === 0;
                      const modelsToShow = !isFallback
                        ? reasoningModels
                        : LLM_PROVIDERS.flatMap((p) => p.recommendedModels)
                            .filter((m) => m.tier === 'reasoning')
                            .slice(0, 5);

                      return (
                        <div
                          style={{
                            marginBottom: '1.25rem',
                            padding: '0.75rem',
                            background: 'var(--bg-input, rgba(255,255,255,0.02))',
                            border: '1px dashed var(--border-subtle)',
                            borderRadius: 'var(--radius-md)',
                          }}
                        >
                          <div
                            style={{
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              color: 'var(--text-secondary)',
                              marginBottom: '0.5rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                            }}
                          >
                            <Sparkles size={14} style={{ color: 'var(--accent-primary)' }} />
                            {isFallback
                              ? 'Recommended Tailoring & Deep Reasoning Models (other providers):'
                              : `Recommended Tailoring & Deep Reasoning Models (${providerMeta?.name || 'Selected Provider'}):`}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {modelsToShow.map((m) => {
                              const isCurrent = formSettings.tailor_model === m.id;
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => {
                                    handleFieldChange('tailor_model', m.id);
                                    setIsDirty(true);
                                  }}
                                  style={{
                                    padding: '0.35rem 0.65rem',
                                    borderRadius: 'var(--radius-sm)',
                                    fontSize: '0.78rem',
                                    border: isCurrent
                                      ? '1px solid var(--accent-primary)'
                                      : '1px solid var(--border-subtle)',
                                    background: isCurrent
                                      ? 'rgba(99, 102, 241, 0.15)'
                                      : 'var(--bg-card)',
                                    color: isCurrent
                                      ? 'var(--accent-primary)'
                                      : 'var(--text-primary)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.35rem',
                                  }}
                                  title={m.description}
                                >
                                  <span>{m.name}</span>
                                  <span
                                    style={{
                                      fontSize: '0.7rem',
                                      padding: '0.1rem 0.35rem',
                                      borderRadius: '3px',
                                      background: isCurrent
                                        ? 'var(--accent-primary)'
                                        : 'var(--border-subtle)',
                                      color: isCurrent ? '#fff' : 'var(--text-muted)',
                                    }}
                                  >
                                    Reasoning
                                  </span>
                                  {isCurrent && <Check size={12} />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Tailor Model input */}
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
                        list="tailor-model-suggestions"
                        value={formSettings.tailor_model}
                        onChange={(e) => handleFieldChange('tailor_model', e.target.value)}
                        className="input-text"
                        placeholder="openrouter/deepseek/deepseek-v4.1-pro"
                      />
                      <datalist id="tailor-model-suggestions">
                        {ALL_RECOMMENDED_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.provider}) - {m.description}
                          </option>
                        ))}
                      </datalist>
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

                    {/* Live Test Tailor LLM Connection */}
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
                            Test Tailoring Model Connectivity
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Verify model access and token generation using{' '}
                            {tailorSyncWithScorer
                              ? 'inherited primary provider credentials'
                              : 'tailor credentials'}
                            .
                          </div>
                        </div>
                        <button
                          type="button"
                          data-testid="test-tailor-llm-btn"
                          onClick={() => handleTestLlm('tailor')}
                          disabled={testingTailorLlm}
                          className="btn btn-secondary btn-sm"
                          style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                        >
                          {testingTailorLlm ? (
                            <>
                              <RefreshCw size={14} className="animate-spin" /> Testing...
                            </>
                          ) : (
                            <>
                              <Send size={14} /> Test Tailor Model
                            </>
                          )}
                        </button>
                      </div>

                      {tailorTestResult && (
                        <div
                          style={{
                            marginTop: '0.75rem',
                            padding: '0.75rem',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.85rem',
                            background: tailorTestResult.success
                              ? 'var(--color-green-bg)'
                              : 'rgba(239, 68, 68, 0.1)',
                            border: `1px solid ${tailorTestResult.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                            color: tailorTestResult.success
                              ? 'var(--color-green)'
                              : 'var(--color-red)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                          }}
                        >
                          {tailorTestResult.success ? (
                            <CheckCircle2 size={16} />
                          ) : (
                            <AlertTriangle size={16} />
                          )}
                          <span>
                            {tailorTestResult.message || tailorTestResult.error}
                            {tailorTestResult.latencyMs !== undefined
                              ? ` (${tailorTestResult.latencyMs}ms)`
                              : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: OBSERVABILITY & TRACING */}
              {activeTab === 'observability' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="settings-card" style={{ padding: '1.5rem' }}>
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
                      Stream prompt tokens, model latency, and evaluation traces to Comet Opik Cloud
                      or your self-hosted Opik instance.
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
                        style={{
                          width: '18px',
                          height: '18px',
                          accentColor: 'var(--accent-primary)',
                        }}
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
                  <ExtensionSyncView />
                </div>
              )}

              {/* TAB: SCRAPERS & SEARCH FILTERS */}
              {activeTab === 'scrapers' && (
                <ScraperSettingsTab
                  config={extensionConfig}
                  onChange={handleExtensionChange}
                  onSave={handleSaveExtensionConfig}
                  saving={savingScrapers}
                  onExtractFromResume={handleExtractFromResume}
                  extractingResume={extractingResume}
                />
              )}

              {/* TAB 6: TELEMETRY & SYSTEM */}
              {activeTab === 'system' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="settings-card" style={{ padding: '1.5rem' }}>
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
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            Status
                          </div>
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
                            {Math.floor(diagnostics.uptime / 60)}m{' '}
                            {Math.floor(diagnostics.uptime % 60)}s
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
                            {diagnostics.environment.nodeVersion} (
                            {diagnostics.environment.platform})
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                        Diagnostics unavailable.
                      </div>
                    )}

                    {/* Storage & Volume Paths */}
                    <div
                      style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}
                    >
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
                          <span style={{ color: 'var(--text-secondary)' }}>
                            SQLite Database Path:
                          </span>
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
                          <span style={{ color: 'var(--text-secondary)' }}>
                            LLM provider endpoint:
                          </span>
                          <code>{formSettings.scorer_api_base || 'Not configured'}</code>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
