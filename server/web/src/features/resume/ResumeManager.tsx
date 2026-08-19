import React, { useState, useEffect } from 'react';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { api, UserResume } from '../../api/client';
import resumeSchema from './resume-schema.json';

const AjvClass = (Ajv as any).default || Ajv;
const addFormatsFn = (addFormats as any).default || addFormats;

const ajv = new AjvClass({ strict: false, allErrors: true, validateSchema: false });
addFormatsFn(ajv);
const schemaValidator = ajv.compile(resumeSchema);

export const ResumeManager: React.FC = () => {
  const [resumes, setResumes] = useState<UserResume[]>([]);
  const [activeResume, setActiveResume] = useState<UserResume | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Editor states
  const [title, setTitle] = useState<string>('Master Resume');
  const [jsonText, setJsonText] = useState<string>('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState<boolean>(false);

  const fetchResumes = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.getResumes();
      setResumes(list);
      const active = list.find((r) => r.isActive) || list[0] || null;
      setActiveResume(active);
      if (active) {
        setTitle(active.title);
        setJsonText(JSON.stringify(active.resume, null, 2));
        validateJson(JSON.stringify(active.resume, null, 2));
      } else {
        // Starter template conforming to JSON Resume v1.0.0
        const starter = {
          $schema: 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
          basics: {
            name: 'Your Name',
            label: 'Software Engineer',
            email: 'you@example.com',
            phone: '+1 555-0100',
            url: 'https://example.com',
            summary: 'Experienced developer specializing in scalable distributed systems.',
            location: { city: 'San Francisco', region: 'CA' },
          },
          skills: [
            { name: 'Languages', keywords: ['TypeScript', 'Python', 'Go', 'Rust'] },
            { name: 'Frameworks & Tools', keywords: ['React', 'Node.js', 'FastAPI', 'Docker'] },
          ],
          work: [
            {
              name: 'Tech Innovators Inc',
              position: 'Senior Backend Engineer',
              startDate: '2022-01-01',
              highlights: [
                'Engineered real-time data pipeline processing 50M events daily.',
                'Reduced query latency by 45% using Redis caching and index optimization.',
              ],
            },
          ],
        };
        setTitle('Master Resume');
        const formatted = JSON.stringify(starter, null, 2);
        setJsonText(formatted);
        validateJson(formatted);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load resumes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResumes();
  }, []);

  const validateJson = (text: string): boolean => {
    try {
      const parsed = JSON.parse(text);
      const isValid = schemaValidator(parsed);
      if (!isValid && schemaValidator.errors) {
        const errors = schemaValidator.errors.map(
          (err) => `${err.instancePath || '/'} ${err.message}`
        );
        setValidationErrors(errors);
        return false;
      }
      setValidationErrors([]);
      return true;
    } catch (e: any) {
      setValidationErrors([`JSON Syntax Error: ${e.message}`]);
      return false;
    }
  };

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    validateJson(text);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      handleJsonChange(content);
      setTitle(file.name.replace(/\.json$/i, '') || 'Uploaded Resume');
    };
    reader.readAsText(file);
  };

  const handleSave = async () => {
    const isValid = validateJson(jsonText);
    if (!isValid) return;

    try {
      const parsed = JSON.parse(jsonText);
      setSaving(true);
      setError(null);
      setSuccess(null);

      await api.uploadResume({
        title: title.trim() || 'Master Resume',
        resumeJson: parsed,
        setActive: true,
      });

      setSuccess('Resume saved and verified against JSON Resume v1.0.0 schema!');
      await fetchResumes();
    } catch (err: any) {
      setError(err.message || 'Failed to save resume');
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchActive = async (id: string) => {
    try {
      await api.setActiveResume(id);
      await fetchResumes();
    } catch (err: any) {
      setError(err.message || 'Failed to switch active resume');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this resume?')) return;
    try {
      await api.deleteResume(id);
      await fetchResumes();
    } catch (err: any) {
      setError(err.message || 'Failed to delete resume');
    }
  };

  const parsedActive = activeResume?.resume;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
            Master Profile & JSON Resume
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Validated against the canonical <a href="https://jsonresume.org/schema/" target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary-light, #818cf8)' }}>JSON Resume v1.0.0 Specification</a>.
          </p>
        </div>

        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
          📁 Upload JSON Resume
          <input
            type="file"
            accept=".json,application/json"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {error && (
        <div
          style={{
            padding: '0.875rem 1rem',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-md)',
            color: '#fca5a5',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          style={{
            padding: '0.875rem 1rem',
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: 'var(--radius-md)',
            color: '#6ee7b7',
            fontSize: '0.85rem',
          }}
        >
          {success}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Left column: Active Profile Preview */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>
              Active Profile Preview
            </h3>
            {activeResume && (
              <span className="badge badge-success">Active Master</span>
            )}
          </div>

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading profile...
            </div>
          ) : parsedActive ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                  {parsedActive.basics?.name || 'Unnamed Candidate'}
                </div>
                <div style={{ color: 'var(--color-primary-light, #818cf8)', fontWeight: 500 }}>
                  {parsedActive.basics?.label || 'No title'}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                  {parsedActive.basics?.email} {parsedActive.basics?.location?.city ? `• ${parsedActive.basics.location.city}` : ''}
                </div>
              </div>

              {parsedActive.basics?.summary && (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {parsedActive.basics.summary}
                </div>
              )}

              {/* Skills */}
              {Array.isArray(parsedActive.skills) && parsedActive.skills.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    Identified Skills
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {parsedActive.skills.flatMap((s: any) =>
                      Array.isArray(s.keywords) ? s.keywords : [s.name]
                    ).map((skill: string, idx: number) => (
                      <span key={idx} className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Work Experience */}
              {Array.isArray(parsedActive.work) && parsedActive.work.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    Experience Summary
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {parsedActive.work.map((w: any, idx: number) => (
                      <div key={idx} style={{ background: 'var(--bg-card-inner, rgba(255,255,255,0.03))', padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-sm)' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                          {w.position} <span style={{ color: 'var(--text-muted)' }}>@ {w.name}</span>
                        </div>
                        {w.highlights && w.highlights[0] && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                            • {w.highlights[0]}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              No master resume uploaded yet. Save the template on the right to get started!
            </div>
          )}

          {/* Saved versions list */}
          {resumes.length > 1 && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem', marginTop: '0.5rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Saved Profiles ({resumes.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {resumes.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.4rem 0.6rem',
                      background: r.isActive ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <span style={{ fontSize: '0.85rem' }}>{r.title}</span>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      {!r.isActive && (
                        <button
                          onClick={() => handleSwitchActive(r.id)}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                        >
                          Make Active
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="btn btn-danger btn-sm"
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: JSON Resume Editor */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>
              JSON Resume Editor
            </h3>
            {validationErrors.length > 0 ? (
              <span className="badge badge-danger" style={{ fontSize: '0.75rem' }}>
                ❌ {validationErrors.length} Schema Error(s)
              </span>
            ) : (
              <span className="badge badge-success" style={{ fontSize: '0.75rem' }}>
                ✓ JSON Resume v1.0.0 Valid
              </span>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.35rem' }}>
              Profile / Resume Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Senior Backend Engineer"
              className="input-text"
            />
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.35rem' }}>
              JSON Schema Content
            </label>
            <textarea
              value={jsonText}
              onChange={(e) => handleJsonChange(e.target.value)}
              className="input-text"
              rows={16}
              style={{
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                lineHeight: 1.4,
                resize: 'vertical',
                whiteSpace: 'pre',
                tabSize: 2,
              }}
              spellCheck={false}
            />
          </div>

          {validationErrors.length > 0 && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.6rem 0.8rem',
                fontSize: '0.8rem',
                color: '#fca5a5',
                maxHeight: '120px',
                overflowY: 'auto',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Schema Validation Issues:</div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                {validationErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              onClick={handleSave}
              disabled={validationErrors.length > 0 || saving}
              className="btn btn-primary"
              style={{ padding: '0.6rem 1.25rem' }}
            >
              {saving ? 'Saving...' : '💾 Save & Activate Master Resume'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
