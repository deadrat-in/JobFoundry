import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import { loadSettings } from '../../lib/auth';

export const ExtensionSyncView: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const settings = loadSettings();
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [rotating, setRotating] = useState(false);

  const handleCopyKey = () => {
    if (!user?.apiKey) return;
    navigator.clipboard.writeText(user.apiKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(settings.apiUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleRotateKey = async () => {
    if (
      !confirm(
        'Rotate your ingest API key? You will need to click "Auto-Connect" in your extension again.'
      )
    ) {
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
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '1rem 0 3rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.8rem',
            fontWeight: 700,
            marginBottom: '0.5rem',
          }}
        >
          Browser Extension Setup & Sync
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          Connect the JobFoundry browser extension to enable 1-click job capture, passive board
          scraping, and automated portal scanning.
        </p>
      </div>

      {/* One-Click Quick Connect Banner */}
      <div
        style={{
          background:
            'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(139, 92, 246, 0.1) 100%)',
          border: '1px solid rgba(99, 102, 241, 0.3)',
          borderRadius: 'var(--radius-lg)',
          padding: '1.5rem',
          marginBottom: '2rem',
          boxShadow: 'var(--shadow-glow)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
          <span style={{ fontSize: '2rem' }}>⚡</span>
          <div style={{ flex: 1 }}>
            <h3
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.2rem',
                fontWeight: 600,
                color: '#e0e7ff',
                marginBottom: '0.35rem',
              }}
            >
              1-Click Auto Connect (Recommended)
            </h3>
            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: '0.9rem',
                lineHeight: 1.5,
                marginBottom: '1rem',
              }}
            >
              While this dashboard is open in your browser, simply click the{' '}
              <strong>JobFoundry extension icon</strong> in your browser toolbar and click{' '}
              <strong>"⚡ Auto-Connect from Active Dashboard"</strong>. The extension securely
              verifies this JobFoundry instance and configures itself instantly.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.85rem',
                  padding: '0.3rem 0.75rem',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-green-bg)',
                  color: 'var(--color-green)',
                  border: '1px solid rgba(16, 185, 129, 0.2)',
                }}
              >
                ✓ Active Dashboard Session Ready
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.85rem',
                  padding: '0.3rem 0.75rem',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text-secondary)',
                }}
              >
                Logged in as <strong>{user?.email}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Connection Details (Manual fallback) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: '1.5rem',
          marginBottom: '2rem',
        }}
      >
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.5rem',
          }}
        >
          <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '1rem' }}>
            🔑 Ingest API Key
          </h3>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.85rem',
              marginBottom: '0.75rem',
            }}
          >
            Your unique user key used by the extension to authenticate and link ingested jobs to
            your account.
          </p>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              type="password"
              value={user?.apiKey || ''}
              readOnly
              style={{
                flex: 1,
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
              }}
            />
            <button
              onClick={handleCopyKey}
              className="btn btn-secondary btn-sm"
              style={{ minWidth: '80px' }}
            >
              {copiedKey ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>

          <button
            onClick={handleRotateKey}
            disabled={rotating}
            className="btn btn-secondary btn-sm"
            style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}
          >
            {rotating ? 'Rotating...' : '🔄 Rotate API Key'}
          </button>
        </div>

        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.5rem',
          }}
        >
          <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '1rem' }}>
            🌐 Backend Server URL
          </h3>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.85rem',
              marginBottom: '0.75rem',
            }}
          >
            The REST API endpoint where the extension sends captured and scanned job payloads.
          </p>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              type="text"
              value={settings.apiUrl}
              readOnly
              style={{
                flex: 1,
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
              }}
            />
            <button
              onClick={handleCopyUrl}
              className="btn btn-secondary btn-sm"
              style={{ minWidth: '80px' }}
            >
              {copiedUrl ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>

          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Default local endpoint: <code>http://localhost:8080</code>
          </div>
        </div>
      </div>

      {/* How to use the extension features */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '1.5rem',
        }}
      >
        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1.25rem' }}>
          🛠️ How Job Discovery Works
        </h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '1rem',
          }}
        >
          <div
            style={{
              padding: '1rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>🎯</div>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              1-Click Page Capture
            </h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Open any job listing on LinkedIn, Indeed, Greenhouse, Lever, Ashby, or Workday. Open
              popup & click <strong>Capture Current Page</strong>.
            </p>
          </div>

          <div
            style={{
              padding: '1rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>📡</div>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              Passive Browsing
            </h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              With <strong>Passive mode</strong> active, the extension automatically extracts job
              listings as you browse job sites and queues them.
            </p>
          </div>

          <div
            style={{
              padding: '1rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>🚀</div>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              Built-in Scrapers
            </h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Click <strong>Scan portals</strong> to query 80+ zero-token scrapers (RemoteOK,
              WeWorkRemotely, Himalayas, Greenhouse feeds, etc.).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
