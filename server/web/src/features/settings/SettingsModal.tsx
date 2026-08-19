import React, { useState } from 'react';
import { AppSettings, DEFAULT_SETTINGS } from '../../lib/auth';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

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
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [threshold, setThreshold] = useState(settings.threshold);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      apiKey: apiKey.trim(),
      apiUrl: apiUrl.trim(),
      threshold: Number(threshold) || 75,
    });
    onClose();
  };

  const handleReset = () => {
    setApiKey(DEFAULT_SETTINGS.apiKey);
    setApiUrl(DEFAULT_SETTINGS.apiUrl);
    setThreshold(DEFAULT_SETTINGS.threshold);
  };

  const handleCopyApiKey = () => {
    if (!user?.apiKey) return;
    navigator.clipboard.writeText(user.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRotateApiKey = async () => {
    if (!confirm('Are you sure you want to rotate your extension API key? You will need to update your browser extension settings.')) {
      return;
    }
    setRotating(true);
    try {
      await api.rotateApiKey();
      await refreshUser();
    } catch (err: any) {
      alert(`Failed to rotate key: ${err.message}`);
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{user.name || user.email}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{user.email}</div>
                  </div>
                  <span className="badge badge-primary">Account</span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                    Browser Extension Pairing Key
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="text"
                      readOnly
                      value={user.apiKey || 'No key generated'}
                      className="input-text"
                      style={{ fontSize: '0.8rem', fontFamily: 'monospace', paddingLeft: '0.75rem' }}
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
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                    Paste this into the JobFoundry browser extension to sync scraped jobs to your account.
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
