import React from 'react';
import { X, Keyboard } from 'lucide-react';

interface KeyboardHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardHelpModal: React.FC<KeyboardHelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 100 }}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '540px', padding: '1.5rem' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.25rem',
            paddingBottom: '0.75rem',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Keyboard size={20} style={{ color: 'var(--accent-primary)' }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Keyboard Shortcuts
            </h3>
          </div>
          <button
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            style={{
              borderRadius: 'var(--radius-full)',
              width: '28px',
              height: '28px',
              padding: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Navigation Section */}
          <div>
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--accent-primary)',
                marginBottom: '0.5rem',
              }}
            >
              Navigation
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: '0.5rem',
                fontSize: '0.85rem',
              }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>Next job down</span>
              <span>
                <kbd className="kbd-pill">J</kbd> or <kbd className="kbd-pill">↓</kbd>
              </span>

              <span style={{ color: 'var(--text-secondary)' }}>Previous job up</span>
              <span>
                <kbd className="kbd-pill">K</kbd> or <kbd className="kbd-pill">↑</kbd>
              </span>

              <span style={{ color: 'var(--text-secondary)' }}>Jump to top of queue</span>
              <span>
                <kbd className="kbd-pill">g</kbd> <kbd className="kbd-pill">g</kbd>
              </span>

              <span style={{ color: 'var(--text-secondary)' }}>Jump to bottom of queue</span>
              <span>
                <kbd className="kbd-pill">G</kbd>
              </span>
            </div>
          </div>

          {/* Triage Actions Section */}
          <div>
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--color-green)',
                marginBottom: '0.5rem',
              }}
            >
              Triage & Actions
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: '0.5rem',
                fontSize: '0.85rem',
              }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>Save / Star active job</span>
              <span>
                <kbd className="kbd-pill">S</kbd>
              </span>

              <span style={{ color: 'var(--text-secondary)' }}>
                Dismiss / Archive (mark rejected)
              </span>
              <span>
                <kbd className="kbd-pill">E</kbd>
              </span>

              <span style={{ color: 'var(--text-secondary)' }}>Mark as Applied</span>
              <span>
                <kbd className="kbd-pill">A</kbd>
              </span>

              <span style={{ color: 'var(--text-secondary)' }}>Tailor CV with AI</span>
              <span>
                <kbd className="kbd-pill">T</kbd>
              </span>

              <span style={{ color: 'var(--text-secondary)' }}>Open posting on job board</span>
              <span>
                <kbd className="kbd-pill">O</kbd> or <kbd className="kbd-pill">Enter</kbd>
              </span>
            </div>
          </div>

          {/* Search & Global Section */}
          <div>
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--color-amber)',
                marginBottom: '0.5rem',
              }}
            >
              Search & Help
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: '0.5rem',
                fontSize: '0.85rem',
              }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>Focus search filter</span>
              <span>
                <kbd className="kbd-pill">/</kbd> or <kbd className="kbd-pill">Ctrl+K</kbd>
              </span>

              <span style={{ color: 'var(--text-secondary)' }}>Open / close this cheatsheet</span>
              <span>
                <kbd className="kbd-pill">?</kbd>
              </span>

              <span style={{ color: 'var(--text-secondary)' }}>Blur input or close modal</span>
              <span>
                <kbd className="kbd-pill">Esc</kbd>
              </span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: '1.25rem', textAlign: 'right' }}>
          <button onClick={onClose} className="btn btn-primary btn-sm">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
