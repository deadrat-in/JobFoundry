import React from 'react';
import { computeResumeDiff, ResumeDiff } from '../../lib/diff';

interface ResumeDiffViewProps {
  originalResume?: Record<string, any>;
  tailoredResume?: Record<string, any>;
}

export const ResumeDiffView: React.FC<ResumeDiffViewProps> = ({
  originalResume = {},
  tailoredResume = {},
}) => {
  const diff: ResumeDiff = computeResumeDiff(originalResume, tailoredResume);

  const hasBasicsDiff = Boolean(diff.basics.labelChange || diff.basics.summaryChange);
  const hasWorkDiff = diff.work.some((w) => w.highlights.some((h) => h.type !== 'unchanged'));
  const hasSkillsDiff = diff.skills.some((s) => s.keywords.some((k) => k.type !== 'unchanged'));

  if (!hasBasicsDiff && !hasWorkDiff && !hasSkillsDiff) {
    return (
      <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        No structural changes detected between the master and tailored resume.
      </div>
    );
  }

  return (
    <div className="diff-container">
      {hasBasicsDiff && (
        <div className="diff-section">
          <h4 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: 'var(--accent-primary)' }}>
            Profile & Summary
          </h4>
          {diff.basics.labelChange && (
            <div style={{ marginBottom: '0.5rem', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Title: </span>
              <span className="diff-item-removed" style={{ display: 'inline' }}>
                {diff.basics.labelChange.original}
              </span>
              {' ➔ '}
              <span className="diff-item-added" style={{ display: 'inline' }}>
                {diff.basics.labelChange.tailored}
              </span>
            </div>
          )}
          {diff.basics.summaryChange && (
            <div style={{ fontSize: '0.85rem' }}>
              <div className="diff-item-removed">{diff.basics.summaryChange.original}</div>
              <div className="diff-item-added">{diff.basics.summaryChange.tailored}</div>
            </div>
          )}
        </div>
      )}

      {hasWorkDiff && (
        <div className="diff-section">
          <h4 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent-primary)' }}>
            Work Experience Highlights
          </h4>
          {diff.work.map((w, idx) => (
            <div key={idx} style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.35rem' }}>
                {w.company} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({w.position})</span>
              </div>
              <div style={{ paddingLeft: '0.5rem' }}>
                {w.highlights.map((h, hIdx) => {
                  if (h.type === 'added') {
                    return (
                      <div key={hIdx} className="diff-item-added">
                        + {h.text}
                      </div>
                    );
                  }
                  if (h.type === 'removed') {
                    return (
                      <div key={hIdx} className="diff-item-removed">
                        - {h.text}
                      </div>
                    );
                  }
                  return (
                    <div key={hIdx} className="diff-item-unchanged" style={{ fontSize: '0.85rem' }}>
                      • {h.text}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasSkillsDiff && (
        <div className="diff-section">
          <h4 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent-primary)' }}>
            Skills & Keywords
          </h4>
          {diff.skills.map((s, idx) => (
            <div key={idx} style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.25rem' }}>{s.name}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {s.keywords.map((k, kIdx) => {
                  if (k.type === 'added') {
                    return (
                      <span key={kIdx} className="skill-chip skill-matching">
                        + {k.text}
                      </span>
                    );
                  }
                  if (k.type === 'removed') {
                    return (
                      <span key={kIdx} className="skill-chip skill-missing">
                        - {k.text}
                      </span>
                    );
                  }
                  return (
                    <span key={kIdx} className="skill-chip" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      {k.text}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
