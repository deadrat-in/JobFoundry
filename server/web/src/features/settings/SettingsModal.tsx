import React, { useState } from 'react';
import { AppSettings, DEFAULT_SETTINGS } from '../../lib/auth';

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
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [threshold, setThreshold] = useState(settings.threshold);

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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '500px' }}
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
                Server API Key (Authorization Bearer)
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter API key configured in .env"
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
                Leave empty if running locally in unauthenticated development mode.
              </span>
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
