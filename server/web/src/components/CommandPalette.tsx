import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Briefcase,
  Kanban,
  Activity,
  FileText,
  Puzzle,
  Settings,
  Plus,
  Moon,
  Sun,
  Laptop,
  ArrowRight,
  Sparkles,
  Command,
  X,
} from 'lucide-react';
import { Job } from '../types/job';
import { useTheme, ACCENT_THEMES, AccentTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  jobs: Job[];
  onOpenAddJob: () => void;
  onRefreshJobs: () => void;
}

interface PaletteItem {
  id: string;
  category: 'Pages' | 'Jobs' | 'Actions' | 'Themes';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  badge?: string;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  jobs,
  onOpenAddJob,
  onRefreshJobs,
}) => {
  const navigate = useNavigate();
  const { setColorMode, setAccentTheme, colorMode } = useTheme();
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build items list
  const items: PaletteItem[] = useMemo(() => {
    const list: PaletteItem[] = [];

    // 1. Pages
    list.push(
      {
        id: 'nav-feed',
        category: 'Pages',
        title: 'Job Feed',
        subtitle: 'View and filter all discovered opportunities',
        icon: <Briefcase size={16} />,
        action: () => {
          navigate('/feed');
          onClose();
        },
      },
      {
        id: 'nav-tracker',
        category: 'Pages',
        title: 'Application Tracker',
        subtitle: 'Manage active pipelines in Kanban view',
        icon: <Kanban size={16} />,
        action: () => {
          navigate('/tracker');
          onClose();
        },
      },
      {
        id: 'nav-pipeline',
        category: 'Pages',
        title: 'Pipeline Monitor',
        subtitle: 'Check background tailoring and scoring telemetry',
        icon: <Activity size={16} />,
        action: () => {
          navigate('/pipeline');
          onClose();
        },
      },
      {
        id: 'nav-profile',
        category: 'Pages',
        title: 'Master Profile & Resume',
        subtitle: 'Update your career profile, skills, and JSON resume',
        icon: <FileText size={16} />,
        action: () => {
          navigate('/profile');
          onClose();
        },
      },
      {
        id: 'nav-sync',
        category: 'Pages',
        title: 'Extension Sync',
        subtitle: 'Configure JobFoundry Chrome/Firefox extension pairing',
        icon: <Puzzle size={16} />,
        action: () => {
          navigate('/extension-sync');
          onClose();
        },
      },
      {
        id: 'nav-settings',
        category: 'Pages',
        title: 'Settings & Appearance',
        subtitle: 'Adjust match threshold, API credentials, and themes',
        icon: <Settings size={16} />,
        action: () => {
          navigate('/settings');
          onClose();
        },
      }
    );

    // 2. Actions
    list.push(
      {
        id: 'act-add-job',
        category: 'Actions',
        title: 'Add New Job',
        subtitle: 'Manually insert a job posting with URL and description',
        icon: <Plus size={16} />,
        action: () => {
          onClose();
          onOpenAddJob();
        },
      },
      {
        id: 'act-refresh',
        category: 'Actions',
        title: 'Refresh Data',
        subtitle: 'Sync latest jobs and scoring telemetry from server',
        icon: <Sparkles size={16} />,
        action: () => {
          onClose();
          onRefreshJobs();
          toast.info('Refreshing jobs from database...');
        },
      }
    );

    // 3. Theme Modes
    list.push(
      {
        id: 'theme-system',
        category: 'Themes',
        title: 'Color Mode: Auto (System)',
        subtitle: 'Automatically match OS dark or light appearance',
        icon: <Laptop size={16} />,
        badge: colorMode === 'system' ? 'Active' : undefined,
        action: () => {
          setColorMode('system');
          toast.success('Theme set to System Auto-Detect');
          onClose();
        },
      },
      {
        id: 'theme-dark',
        category: 'Themes',
        title: 'Color Mode: Dark',
        subtitle: 'Sleek dark canvas with high contrast borders',
        icon: <Moon size={16} />,
        badge: colorMode === 'dark' ? 'Active' : undefined,
        action: () => {
          setColorMode('dark');
          toast.success('Dark mode activated');
          onClose();
        },
      },
      {
        id: 'theme-light',
        category: 'Themes',
        title: 'Color Mode: Light',
        subtitle: 'Crisp, clean high-readability daylight canvas',
        icon: <Sun size={16} />,
        badge: colorMode === 'light' ? 'Active' : undefined,
        action: () => {
          setColorMode('light');
          toast.success('Light mode activated');
          onClose();
        },
      }
    );

    // 4. Accent themes
    ACCENT_THEMES.forEach((accent) => {
      list.push({
        id: `accent-${accent.id}`,
        category: 'Themes',
        title: `Accent: ${accent.name}`,
        subtitle: `Set primary accent color to ${accent.id}`,
        icon: (
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: accent.primaryColor,
              display: 'inline-block',
            }}
          />
        ),
        action: () => {
          setAccentTheme(accent.id as AccentTheme);
          toast.success(`Accent changed to ${accent.name}`);
          onClose();
        },
      });
    });

    // 5. All Loaded Jobs
    jobs.forEach((job) => {
      list.push({
        id: `job-${job.id}`,
        category: 'Jobs',
        title: `${job.title} — ${job.company}`,
        subtitle: `${job.location || 'Remote'} • Match: ${job.fit_score ?? 0}% • Status: ${job.status}`,
        icon: <Briefcase size={16} />,
        badge: `${job.fit_score ?? 0}%`,
        action: () => {
          navigate(`/jobs/${job.id}`);
          onClose();
        },
      });
    });

    return list;
  }, [
    jobs,
    colorMode,
    navigate,
    onClose,
    onOpenAddJob,
    onRefreshJobs,
    setColorMode,
    setAccentTheme,
    toast,
  ]);

  // Filter items by query
  const filteredItems = useMemo(() => {
    if (!query.trim()) {
      return items.filter((item) => item.category !== 'Jobs'); // Show quick links when empty
    }
    const q = query.toLowerCase();
    const matched = items.filter((item) => {
      return (
        item.title.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
        item.category.toLowerCase().includes(q)
      );
    });
    // Cap to top 50 matches for high performance rendering
    return matched.slice(0, 50);
  }, [items, query]);

  // Reset selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector('.palette-item.is-selected');
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filteredItems.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % (filteredItems.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="palette-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="palette-modal" onClick={(e) => e.stopPropagation()}>
        {/* Search header */}
        <div className="palette-search-bar">
          <Search size={18} className="palette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="palette-input"
            placeholder="Type a command or search jobs, pages, themes... (Esc to exit)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-expanded={true}
            aria-controls="palette-list"
            aria-activedescendant={filteredItems[selectedIndex]?.id}
          />
          {query && (
            <button
              type="button"
              className="palette-clear-btn"
              onClick={() => setQuery('')}
              aria-label="Clear input"
            >
              <X size={16} />
            </button>
          )}
          <kbd className="palette-shortcut-badge">ESC</kbd>
        </div>

        {/* Results list */}
        <div className="palette-list" ref={listRef} id="palette-list" role="listbox">
          {filteredItems.length === 0 ? (
            <div className="palette-empty">No matching commands or jobs found for "{query}".</div>
          ) : (
            filteredItems.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.id}
                  id={item.id}
                  role="option"
                  aria-selected={isSelected}
                  className={`palette-item ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => item.action()}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="palette-item-icon">{item.icon}</div>
                  <div className="palette-item-text">
                    <div className="palette-item-title">
                      {item.title}
                      {item.badge && <span className="palette-item-badge">{item.badge}</span>}
                    </div>
                    {item.subtitle && <div className="palette-item-subtitle">{item.subtitle}</div>}
                  </div>
                  <div className="palette-item-category">{item.category}</div>
                  <ArrowRight size={14} className="palette-item-arrow" />
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="palette-footer">
          <div className="palette-footer-hints">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> Navigate
            </span>
            <span>
              <kbd>↵</kbd> Select
            </span>
            <span>
              <kbd>ESC</kbd> Close
            </span>
          </div>
          <div className="palette-footer-tip">
            <Command
              size={12}
              style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }}
            />
            Cmd + K
          </div>
        </div>
      </div>
    </div>
  );
};
