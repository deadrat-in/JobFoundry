import React, { useState } from 'react';
import { AppSettings, DEFAULT_SETTINGS } from '../../lib/auth';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import { useTheme, ACCENT_THEMES, ColorMode, AccentTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { Laptop, Moon, Sun, Palette } from 'lucide-react';

interface SettingsModalProps {
  settings: AppSettings;
  isOpen: boolean;
  onClose: () => void;
  onSave: (newSettings: AppSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  isOpen,
  onClose,
  onSave,
}) => {
  const { user, refreshUser } = useAuth();
  const { colorMode, setColorMode, accentTheme, setAccentTheme } = useTheme();
  const toast = useToast();

  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [threshold, setThreshold] = useState(settings.threshold);
  const [tempColorMode, setTempColorMode] = useState<ColorMode>(colorMode);
  const [tempAccentTheme, setTempAccentTheme] = useState<AccentTheme>(accentTheme);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);

  // Sync state only when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setApiKey(settings.apiKey);
      setApiUrl(settings.apiUrl);
      setThreshold(settings.threshold);
      setTempColorMode(colorMode);
      setTempAccentTheme(accentTheme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      apiKey: apiKey.trim(),
      apiUrl: apiUrl.trim(),
      threshold: Number(threshold) || 75,
    });
    if (tempColorMode !== colorMode) {
      setColorMode(tempColorMode);
    }
    if (tempAccentTheme !== accentTheme) {
      setAccentTheme(tempAccentTheme);
    }
    toast.success('Settings saved successfully');
    onClose();
  };

  const handleReset = () => {
    setApiKey(DEFAULT_SETTINGS.apiKey);
    setApiUrl(DEFAULT_SETTINGS.apiUrl);
    setThreshold(DEFAULT_SETTINGS.threshold);
    setTempColorMode('system');
    setTempAccentTheme('indigo');
    toast.info('Settings form reset to defaults (click Save to apply)');
  };

  const handleCopyApiKey = async () => {
    if (!user?.apiKey) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(user.apiKey);
      setCopied(true);
      toast.success('API Key copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy API Key automatically. Please copy it manually.');
    }
  };

  const handleRotateApiKey = async () => {
    if (
      !confirm(
        'Are you sure you want to rotate your extension API key? You will need to update your browser extension settings.'
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '520px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 style={{ fontSize: '1.2rem' }}>Dashboard Settings</h2>
          <button
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            style={{ borderRadius: 'var(--radius-full)' }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div
            className="modal-body"
            style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
          >
            {/* User Account Info */}
            {user && (
              <div
                style={{
                  background: 'rgba(99, 102, 241, 0.08)',
                  border: '1px solid rgba(99, 102, 241, 0.2)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                      {user.name || user.email}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {user.email}
                    </div>
                  </div>
                  <span className="badge badge-primary">Account</span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      marginBottom: '0.25rem',
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
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                        paddingLeft: '0.75rem',
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleCopyApiKey}
                      className="btn btn-secondary btn-sm"
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {copied ? '✓ Copied' : '📋 Copy'}
                    </button>
                    <button
                      type="button"
                      onClick={handleRotateApiKey}
                      disabled={rotating}
                      className="btn btn-secondary btn-sm"
                      title="Rotate API Key"
                    >
                      🔄
                    </button>
                  </div>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.25rem',
                      display: 'block',
                    }}
                  >
                    Paste this into the JobFoundry browser extension to sync scraped jobs to your
                    account.
                  </span>
                </div>
              </div>
            )}

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  marginBottom: '0.35rem',
                }}
              >
                Ingest & Server API URL
              </label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="http://localhost:8080"
                className="input-text"
                style={{ paddingLeft: '0.875rem' }}
                required
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  marginBottom: '0.35rem',
                }}
              >
                Fit Score Pass Threshold (0 – 100)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="input-text"
                style={{ paddingLeft: '0.875rem' }}
              />
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginTop: '0.25rem',
                  display: 'block',
                }}
              >
                Jobs scoring at or above this threshold will qualify for automatic tailoring
                (Default: 75).
              </span>
            </div>

            {/* Appearance & Theming */}
            <div className="appearance-section">
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  marginBottom: '0.25rem',
                  color: 'var(--text-primary)',
                }}
              >
                <Palette size={16} style={{ color: 'var(--accent-primary)' }} />
                Appearance & Themes
              </label>
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  display: 'block',
                  marginBottom: '0.75rem',
                }}
              >
                Choose your preferred interface theme and system auto-detection.
              </span>

              {/* Color Mode */}
              <div style={{ marginBottom: '1rem' }}>
                <span
                  style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}
                >
                  Color Mode
                </span>
                <div className="mode-selector-group">
                  <button
                    type="button"
                    className={`mode-selector-btn ${tempColorMode === 'system' ? 'active' : ''}`}
                    aria-pressed={tempColorMode === 'system'}
                    onClick={() => setTempColorMode('system')}
                    title="Automatically match OS theme"
                  >
                    <Laptop size={16} /> Auto
                  </button>
                  <button
                    type="button"
                    className={`mode-selector-btn ${tempColorMode === 'dark' ? 'active' : ''}`}
                    aria-pressed={tempColorMode === 'dark'}
                    onClick={() => setTempColorMode('dark')}
                    title="Force dark theme"
                  >
                    <Moon size={16} /> Dark
                  </button>
                  <button
                    type="button"
                    className={`mode-selector-btn ${tempColorMode === 'light' ? 'active' : ''}`}
                    aria-pressed={tempColorMode === 'light'}
                    onClick={() => setTempColorMode('light')}
                    title="Force light theme"
                  >
                    <Sun size={16} /> Light
                  </button>
                </div>
              </div>

              {/* Accent Color */}
              <div>
                <span
                  style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}
                >
                  Accent Color
                </span>
                <div className="accent-selector-group">
                  {ACCENT_THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      className={`accent-swatch-btn ${tempAccentTheme === theme.id ? 'active' : ''}`}
                      aria-pressed={tempAccentTheme === theme.id}
                      onClick={() => setTempAccentTheme(theme.id)}
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
          </div>

          <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
            <button type="button" onClick={handleReset} className="btn btn-secondary btn-sm">
              Reset Defaults
            </button>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm">
                Save Changes
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
