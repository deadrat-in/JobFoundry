import React, { useState, useMemo, useEffect } from 'react';
import { ExtensionConfig } from '../../api/client';
import {
  Compass,
  Search,
  Sparkles,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Sliders,
  Globe,
  MapPin,
  Clock,
  Save,
  X,
} from 'lucide-react';

export interface ScraperSettingsTabProps {
  config: ExtensionConfig;
  onChange: (updated: ExtensionConfig) => void;
  onSave: () => Promise<void>;
  saving: boolean;
  onExtractFromResume: () => Promise<void>;
  extractingResume: boolean;
}

interface PortalMetadata {
  id: string;
  name: string;
  category: 'global' | 'regional' | 'company';
  description: string;
  isPaidBoard?: boolean;
  recommended: boolean;
}

export const PORTAL_CATALOG: PortalMetadata[] = [
  // Global Remote
  {
    id: 'remoteok',
    name: 'RemoteOK',
    category: 'global',
    description: 'Global remote developer jobs',
    isPaidBoard: true,
    recommended: false,
  },
  {
    id: 'weworkremotely',
    name: 'We Work Remotely',
    category: 'global',
    description: 'Top remote tech postings & RSS',
    isPaidBoard: true,
    recommended: false,
  },
  {
    id: 'himalayas',
    name: 'Himalayas',
    category: 'global',
    description: 'Curated remote engineering roles',
    recommended: true,
  },
  {
    id: 'arbeitnow',
    name: 'Arbeitnow',
    category: 'global',
    description: 'European & remote tech roles',
    recommended: true,
  },
  {
    id: 'jobspresso',
    name: 'Jobspresso',
    category: 'global',
    description: 'Expertly reviewed tech & dev jobs',
    recommended: true,
  },
  {
    id: '4dayweek',
    name: '4 Day Week',
    category: 'global',
    description: '4-day workweek software roles',
    recommended: true,
  },
  {
    id: 'remotive',
    name: 'Remotive',
    category: 'global',
    description: 'Remote jobs in tech & engineering',
    recommended: true,
  },
  {
    id: 'workingnomads',
    name: 'Working Nomads',
    category: 'global',
    description: 'Curated remote jobs for digital nomads',
    recommended: true,
  },
  {
    id: 'hackernews',
    name: 'Hacker News',
    category: 'global',
    description: "Monthly HN 'Who is hiring?' threads",
    recommended: true,
  },
  {
    id: 'cryptocurrencyjobs',
    name: 'CryptocurrencyJobs',
    category: 'global',
    description: 'Web3 & crypto remote roles',
    recommended: true,
  },
  {
    id: 'nodesk',
    name: 'Nodesk',
    category: 'global',
    description: 'Remote-first job listings & feeds',
    recommended: true,
  },
  {
    id: 'larajobs',
    name: 'LaraJobs',
    category: 'global',
    description: 'Laravel, PHP & full-stack jobs',
    recommended: true,
  },
  {
    id: 'torre',
    name: 'Torre',
    category: 'global',
    description: 'AI-matched global tech listings',
    recommended: true,
  },
  {
    id: 'themuse',
    name: 'The Muse',
    category: 'global',
    description: 'Company profiles & job discovery',
    recommended: true,
  },
  {
    id: 'landingjobs',
    name: 'Landing.jobs',
    category: 'global',
    description: 'European tech careers marketplace',
    recommended: true,
  },
  {
    id: 'flowxtra',
    name: 'FlowXtra',
    category: 'global',
    description: 'Developer & technology postings',
    recommended: true,
  },
  {
    id: 'thehub',
    name: 'The Hub',
    category: 'global',
    description: 'Nordic & European tech startups',
    recommended: true,
  },
  {
    id: 'agentic-jobs',
    name: 'Agentic Jobs',
    category: 'global',
    description: 'AI agents, LLM & tooling roles',
    recommended: true,
  },

  // Regional & Niche
  {
    id: 'jobicy',
    name: 'Jobicy',
    category: 'regional',
    description: 'Worldwide remote & regional tech',
    recommended: true,
  },
  {
    id: 'remotli',
    name: 'Remotli',
    category: 'regional',
    description: 'Modern tech & developer feed',
    recommended: true,
  },
  {
    id: 'getonbrd',
    name: 'Get on Board',
    category: 'regional',
    description: 'Latin America technology roles',
    recommended: true,
  },
  {
    id: 'manfred',
    name: 'Manfred',
    category: 'regional',
    description: 'Spain & European tech careers',
    recommended: true,
  },
  {
    id: 'wttj',
    name: 'Welcome to the Jungle',
    category: 'regional',
    description: 'France & European tech ecosystem',
    recommended: true,
  },
  {
    id: 'nofluffjobs',
    name: 'No Fluff Jobs',
    category: 'regional',
    description: 'Transparent salary IT jobs in CEE',
    recommended: true,
  },
  {
    id: 'justjoin',
    name: 'Just Join IT',
    category: 'regional',
    description: 'Leading Central European tech board',
    recommended: true,
  },
  {
    id: 'solidjobs',
    name: 'Solid.Jobs',
    category: 'regional',
    description: 'Poland IT job offers with salary',
    recommended: true,
  },
  {
    id: 'senjob',
    name: 'SenJob',
    category: 'regional',
    description: 'Francophone Africa & Senegal jobs',
    recommended: true,
  },
  {
    id: 'jobbankca',
    name: 'Job Bank Canada',
    category: 'regional',
    description: 'Official Government of Canada job board',
    recommended: true,
  },
  {
    id: 'arbeitsagentur',
    name: 'Bundesagentur für Arbeit',
    category: 'regional',
    description: 'Official German federal job portal',
    recommended: true,
  },
  {
    id: 'vdab',
    name: 'VDAB',
    category: 'regional',
    description: 'Flanders public employment service',
    recommended: true,
  },
  {
    id: 'higheredjobs',
    name: 'HigherEdJobs',
    category: 'regional',
    description: 'Academic & research tech positions',
    recommended: true,
  },
  {
    id: 'glints',
    name: 'Glints',
    category: 'regional',
    description: 'Southeast Asia tech & developer roles',
    recommended: true,
  },
  {
    id: 'jobstreet',
    name: 'JobStreet',
    category: 'regional',
    description: 'Southeast Asia major job portal',
    recommended: true,
  },
  {
    id: 'mycareersfuture',
    name: 'MyCareersFuture',
    category: 'regional',
    description: 'Singapore government career portal',
    recommended: true,
  },
  {
    id: 'careerviet',
    name: 'CareerViet',
    category: 'regional',
    description: 'Vietnam technology & enterprise jobs',
    recommended: true,
  },
  {
    id: 'itviec',
    name: 'ITviec',
    category: 'regional',
    description: 'Vietnam top developer job board',
    recommended: true,
  },
  {
    id: 'yourator',
    name: 'Yourator',
    category: 'regional',
    description: 'Taiwan tech & startup job marketplace',
    recommended: true,
  },

  // Company & ATS
  {
    id: 'ibm',
    name: 'IBM Careers',
    category: 'company',
    description: 'Global enterprise positions',
    recommended: true,
  },
  {
    id: 'amazon',
    name: 'Amazon Jobs',
    category: 'company',
    description: 'Global AWS & retail engineering',
    recommended: true,
  },
  {
    id: 'a16z-speedrun-talent',
    name: 'a16z Speedrun Talent',
    category: 'company',
    description: 'Andreessen Horowitz gaming/AI portfolio',
    recommended: true,
  },
];

function splitList(val: string): string[] {
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinList(arr?: string[]): string {
  return (arr || []).join(', ');
}

export const ScraperSettingsTab: React.FC<ScraperSettingsTabProps> = ({
  config,
  onChange,
  onSave,
  saving,
  onExtractFromResume,
  extractingResume,
}) => {
  const [portalSearch, setPortalSearch] = useState('');
  const [portalCategory, setPortalCategory] = useState<'all' | 'global' | 'regional' | 'company'>(
    'all'
  );

  const positiveKeywords = config.titleFilter?.positive || [];
  const negativeKeywords = config.titleFilter?.negative || [];
  const portals = config.portals || {};

  const [positiveDraft, setPositiveDraft] = useState(() => joinList(config.titleFilter?.positive));
  const [negativeDraft, setNegativeDraft] = useState(() => joinList(config.titleFilter?.negative));
  const [allowedLocDraft, setAllowedLocDraft] = useState(() =>
    joinList(config.locationFilter?.allow)
  );
  const [blockedLocDraft, setBlockedLocDraft] = useState(() =>
    joinList(config.locationFilter?.block)
  );

  // Synchronize draft states if config changes externally (e.g. resume extraction or initial load)
  useEffect(() => {
    const incoming = (config.titleFilter?.positive || []).join(',');
    if (splitList(positiveDraft).join(',') !== incoming) {
      setPositiveDraft(joinList(config.titleFilter?.positive));
    }
  }, [config.titleFilter?.positive]);

  useEffect(() => {
    const incoming = (config.titleFilter?.negative || []).join(',');
    if (splitList(negativeDraft).join(',') !== incoming) {
      setNegativeDraft(joinList(config.titleFilter?.negative));
    }
  }, [config.titleFilter?.negative]);

  useEffect(() => {
    const incoming = (config.locationFilter?.allow || []).join(',');
    if (splitList(allowedLocDraft).join(',') !== incoming) {
      setAllowedLocDraft(joinList(config.locationFilter?.allow));
    }
  }, [config.locationFilter?.allow]);

  useEffect(() => {
    const incoming = (config.locationFilter?.block || []).join(',');
    if (splitList(blockedLocDraft).join(',') !== incoming) {
      setBlockedLocDraft(joinList(config.locationFilter?.block));
    }
  }, [config.locationFilter?.block]);

  const handlePositiveChange = (text: string) => {
    setPositiveDraft(text);
    onChange({
      ...config,
      titleFilter: {
        ...config.titleFilter,
        positive: splitList(text),
      },
    });
  };

  const handleNegativeChange = (text: string) => {
    setNegativeDraft(text);
    onChange({
      ...config,
      titleFilter: {
        ...config.titleFilter,
        negative: splitList(text),
      },
    });
  };

  const handleAllowedLocChange = (text: string) => {
    setAllowedLocDraft(text);
    onChange({
      ...config,
      locationFilter: {
        ...config.locationFilter,
        allow: splitList(text),
      },
    });
  };

  const handleBlockedLocChange = (text: string) => {
    setBlockedLocDraft(text);
    onChange({
      ...config,
      locationFilter: {
        ...config.locationFilter,
        block: splitList(text),
      },
    });
  };

  const handleTogglePortal = (id: string) => {
    const currentVal = portals[id] !== false && portals[id] !== undefined;
    onChange({
      ...config,
      portals: {
        ...portals,
        [id]: !currentVal,
      },
    });
  };

  const handleEnableAllPortals = () => {
    const updated: Record<string, boolean> = { ...portals };
    for (const p of PORTAL_CATALOG) {
      updated[p.id] = true;
    }
    onChange({ ...config, portals: updated });
  };

  const handleDisableAllPortals = () => {
    const updated: Record<string, boolean> = { ...portals };
    for (const p of PORTAL_CATALOG) {
      updated[p.id] = false;
    }
    onChange({ ...config, portals: updated });
  };

  const handleResetRecommendedPortals = () => {
    const updated: Record<string, boolean> = { ...portals };
    for (const p of PORTAL_CATALOG) {
      updated[p.id] = p.recommended;
    }
    onChange({ ...config, portals: updated });
  };

  const filteredPortals = useMemo(() => {
    return PORTAL_CATALOG.filter((p) => {
      const matchCat = portalCategory === 'all' || p.category === portalCategory;
      const q = portalSearch.toLowerCase().trim();
      const matchQuery =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q);
      return matchCat && matchQuery;
    });
  }, [portalSearch, portalCategory]);

  const activePortalsCount = PORTAL_CATALOG.filter(
    (p) => portals[p.id] !== false && portals[p.id] !== undefined
  ).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Tab Banner / Description */}
      <div
        style={{
          background:
            'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(139, 92, 246, 0.08) 100%)',
          border: '1px solid rgba(99, 102, 241, 0.25)',
          borderRadius: 'var(--radius-lg)',
          padding: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              fontFamily: 'var(--font-display)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '0.35rem',
            }}
          >
            <Compass size={20} style={{ color: 'var(--color-indigo)' }} />
            Scrapers & Search Filters
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', maxWidth: '650px' }}>
            Configure target keywords, negative exclusion terms, location rules, and scraper portal
            feeds. Changes persist directly to SQLite and sync automatically to your paired browser
            companion extension.
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}
        >
          <Save size={15} />
          {saving ? 'Saving...' : 'Save Filters & Scrapers'}
        </button>
      </div>

      {/* 1. Target Role Keywords (Positive Matches) */}
      <div className="settings-card" style={{ padding: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
            marginBottom: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              Target Role Keywords (Positive Matches)
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Only jobs matching at least one of these keywords will be ingested. Leave empty to
              allow all detected software roles.
            </p>
          </div>
          <button
            type="button"
            onClick={onExtractFromResume}
            disabled={extractingResume}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Sparkles size={14} style={{ color: 'var(--color-amber)' }} />
            {extractingResume ? 'Extracting...' : 'Fetch from Master Resume'}
          </button>
        </div>

        <div style={{ marginBottom: '0.75rem' }}>
          <textarea
            aria-label="Target Role Keywords"
            rows={3}
            value={positiveDraft}
            onChange={(e) => handlePositiveChange(e.target.value)}
            placeholder="e.g. Software Engineer, Fullstack, Frontend, Backend, React, Python, AI Engineer"
            className="input-text"
            style={{ width: '100%', fontFamily: 'inherit', resize: 'vertical' }}
          />
        </div>

        {/* Chips preview */}
        {positiveKeywords.length > 0 && (
          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem' }}
          >
            {positiveKeywords.map((kw, i) => (
              <span
                key={i}
                className="badge"
                style={{
                  background: 'rgba(99, 102, 241, 0.15)',
                  color: '#c7d2fe',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.25rem 0.6rem',
                }}
              >
                {kw}
                <button
                  type="button"
                  aria-label={`Remove positive keyword ${kw}`}
                  onClick={() => {
                    const next = positiveKeywords.filter((_, idx) => idx !== i);
                    setPositiveDraft(joinList(next));
                    onChange({
                      ...config,
                      titleFilter: { ...config.titleFilter, positive: next },
                    });
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    color: '#c7d2fe',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            background: 'var(--bg-primary)',
            padding: '0.6rem 0.85rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <strong>Advanced syntax:</strong> Use <code>word:intern</code> for exact whole-word
          matching, <code>stem:agent</code> for word-prefix matching, and{' '}
          <code>director + engineering</code> for multi-word conjunctions.
        </div>
      </div>

      {/* 2. Negative Excluded Keywords */}
      <div className="settings-card" style={{ padding: '1.5rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.25rem' }}>
          Negative Excluded Keywords
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
          Jobs matching any of these terms will be immediately rejected before scoring or ingestion.
        </p>

        <textarea
          aria-label="Negative Excluded Keywords"
          rows={2}
          value={negativeDraft}
          onChange={(e) => handleNegativeChange(e.target.value)}
          placeholder="e.g. word:intern, junior, .net, php, wordpress, embedded, firmware"
          className="input-text"
          style={{
            width: '100%',
            fontFamily: 'inherit',
            resize: 'vertical',
            marginBottom: '0.75rem',
          }}
        />

        {negativeKeywords.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {negativeKeywords.map((kw, i) => (
              <span
                key={i}
                className="badge"
                style={{
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: '#fca5a5',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.25rem 0.6rem',
                }}
              >
                {kw}
                <button
                  type="button"
                  aria-label={`Remove negative keyword ${kw}`}
                  onClick={() => {
                    const next = negativeKeywords.filter((_, idx) => idx !== i);
                    setNegativeDraft(joinList(next));
                    onChange({
                      ...config,
                      titleFilter: { ...config.titleFilter, negative: next },
                    });
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    color: '#fca5a5',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 3. Search Scope & Location Filters */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '1.5rem',
        }}
      >
        {/* Max Posting Age */}
        <div className="settings-card" style={{ padding: '1.5rem' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}
          >
            <Clock size={18} style={{ color: 'var(--color-indigo)' }} />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600 }}>Max Posting Age</h3>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Discard listings older than N days (jobs without explicit published dates are always
            preserved).
          </p>
          <select
            value={String(config.maxPostingAgeDays ?? 30)}
            onChange={(e) =>
              onChange({
                ...config,
                maxPostingAgeDays: Number(e.target.value),
              })
            }
            className="input-text"
            style={{ width: '100%' }}
          >
            <option value="7">Within 7 days (Fresh only)</option>
            <option value="14">Within 14 days</option>
            <option value="30">Within 30 days (Recommended)</option>
            <option value="60">Within 60 days</option>
            <option value="0">All Time (No date restriction)</option>
          </select>
        </div>

        {/* Location Filtering */}
        <div className="settings-card" style={{ padding: '1.5rem' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}
          >
            <MapPin size={18} style={{ color: 'var(--color-indigo)' }} />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600 }}>Location Filtering</h3>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Filter jobs matching geographical terms or remote designations.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label
                htmlFor="allowed-locations-input"
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  marginBottom: '0.25rem',
                }}
              >
                Allowed Locations (comma-separated):
              </label>
              <input
                id="allowed-locations-input"
                type="text"
                value={allowedLocDraft}
                onChange={(e) => handleAllowedLocChange(e.target.value)}
                placeholder="e.g. remote, worldwide, united states, europe"
                className="input-text"
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label
                htmlFor="blocked-locations-input"
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  marginBottom: '0.25rem',
                }}
              >
                Blocked Locations (comma-separated):
              </label>
              <input
                id="blocked-locations-input"
                type="text"
                value={blockedLocDraft}
                onChange={(e) => handleBlockedLocChange(e.target.value)}
                placeholder="e.g. on-site only, hybrid, confidential"
                className="input-text"
                style={{ width: '100%' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 4. Background Automation & Companion Sync */}
      <div className="settings-card" style={{ padding: '1.5rem' }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}
        >
          <Sliders size={18} style={{ color: 'var(--color-indigo)' }} />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 600 }}>Extension Background Automation</h3>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          Tune how the browser companion extension executes passive captures and periodic portal
          scans.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '1.25rem',
          }}
        >
          {/* Scan Interval */}
          <div>
            <label
              htmlFor="scan-interval-input"
              style={{
                display: 'block',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                marginBottom: '0.35rem',
              }}
            >
              Scan Interval (Hours)
            </label>
            <input
              id="scan-interval-input"
              type="number"
              min="1"
              max="72"
              value={config.scanIntervalHours || 6}
              onChange={(e) =>
                onChange({
                  ...config,
                  scanIntervalHours: Math.max(1, Number(e.target.value)),
                })
              }
              className="input-text"
              style={{ width: '100%' }}
            />
            <span
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginTop: '0.25rem',
                display: 'block',
              }}
            >
              Extension alarms trigger periodic runs every {config.scanIntervalHours || 6}h.
            </span>
          </div>

          {/* Passive Browsing Capture Toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Passive Browsing Capture</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Ingest jobs viewed while naturally browsing supported boards
              </div>
            </div>
            <input
              type="checkbox"
              aria-label="Passive Browsing Capture"
              checked={Boolean(config.passiveMode)}
              onChange={(e) => onChange({ ...config, passiveMode: e.target.checked })}
              style={{
                width: '1.2rem',
                height: '1.2rem',
                accentColor: 'var(--color-indigo)',
                cursor: 'pointer',
              }}
            />
          </div>

          {/* Active Scheduled Scan Toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Scheduled Background Scans</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Wake extension to periodically query enabled portals
              </div>
            </div>
            <input
              type="checkbox"
              aria-label="Scheduled Background Scans"
              checked={Boolean(config.activeMode)}
              onChange={(e) => onChange({ ...config, activeMode: e.target.checked })}
              style={{
                width: '1.2rem',
                height: '1.2rem',
                accentColor: 'var(--color-indigo)',
                cursor: 'pointer',
              }}
            />
          </div>
        </div>
      </div>

      {/* 5. Provider / Scraper Portal Catalog */}
      <div className="settings-card" style={{ padding: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
            marginBottom: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '0.25rem',
              }}
            >
              <Globe size={18} style={{ color: 'var(--color-indigo)' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Scraper & Feed Portal Catalog</h3>
              <span className="badge badge-primary">
                {activePortalsCount} / {PORTAL_CATALOG.length} Active
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Toggle automated feeds and scrapers. Providers marked with ✦ charge fees to employers
              (free to browse).
            </p>
          </div>

          {/* Batch Actions */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleEnableAllPortals}
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <CheckCircle2 size={13} style={{ color: 'var(--color-green)' }} /> Enable All
            </button>
            <button
              type="button"
              onClick={handleDisableAllPortals}
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <XCircle size={13} style={{ color: 'var(--color-red)' }} /> Disable All
            </button>
            <button
              type="button"
              onClick={handleResetRecommendedPortals}
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <RotateCcw size={13} /> Recommended
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            marginBottom: '1.25rem',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <div style={{ position: 'relative', flex: '1', minWidth: '220px' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: '0.75rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              value={portalSearch}
              onChange={(e) => setPortalSearch(e.target.value)}
              placeholder="Search portals (e.g. Himalayas, RemoteOK, Europe, AWS)..."
              className="input-text"
              style={{ paddingLeft: '2.25rem', width: '100%' }}
            />
          </div>

          {/* Category Tabs */}
          <div
            style={{
              display: 'flex',
              gap: '0.35rem',
              background: 'var(--bg-primary)',
              padding: '0.25rem',
              borderRadius: 'var(--radius-md)',
            }}
          >
            {(
              [
                ['all', 'All'],
                ['global', 'Global Remote'],
                ['regional', 'Regional & Niche'],
                ['company', 'Company / ATS'],
              ] as const
            ).map(([cat, label]) => (
              <button
                key={cat}
                type="button"
                onClick={() => setPortalCategory(cat)}
                className={`btn btn-sm ${portalCategory === cat ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Portals Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))',
            gap: '0.75rem',
            maxHeight: '520px',
            overflowY: 'auto',
            paddingRight: '0.25rem',
          }}
        >
          {filteredPortals.map((portal) => {
            const isEnabled = portals[portal.id] !== false && portals[portal.id] !== undefined;
            return (
              <label
                key={portal.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  padding: '0.85rem',
                  background: isEnabled ? 'rgba(99, 102, 241, 0.05)' : 'var(--bg-primary)',
                  border: isEnabled
                    ? '1px solid rgba(99, 102, 241, 0.3)'
                    : '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={() => handleTogglePortal(portal.id)}
                  style={{
                    marginTop: '0.15rem',
                    width: '1.15rem',
                    height: '1.15rem',
                    accentColor: 'var(--color-indigo)',
                    cursor: 'pointer',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.35rem',
                      marginBottom: '0.2rem',
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '0.9rem',
                        color: isEnabled ? 'var(--text-primary)' : 'var(--text-muted)',
                      }}
                    >
                      {portal.name}{' '}
                      {portal.isPaidBoard && <span title="Paid posting board">✦</span>}
                    </span>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        padding: '0.1rem 0.4rem',
                        borderRadius: 'var(--radius-full)',
                        background: isEnabled ? 'var(--color-green-bg)' : 'rgba(255,255,255,0.05)',
                        color: isEnabled ? 'var(--color-green)' : 'var(--text-muted)',
                        fontWeight: 600,
                      }}
                    >
                      {isEnabled ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      lineHeight: 1.35,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={portal.description}
                  >
                    {portal.description}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {filteredPortals.length === 0 && (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.9rem',
            }}
          >
            No scraper portals matching "{portalSearch}".
          </div>
        )}
      </div>

      {/* Save Button Footer */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1.5rem' }}
        >
          <Save size={16} />
          {saving ? 'Saving...' : 'Save Filters & Scrapers'}
        </button>
      </div>
    </div>
  );
};
