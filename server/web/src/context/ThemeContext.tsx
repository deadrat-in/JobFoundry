import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type ColorMode = 'system' | 'dark' | 'light';
export type AccentTheme = 'indigo' | 'cyan' | 'emerald' | 'purple' | 'amber';

export interface AccentOption {
  id: AccentTheme;
  name: string;
  primaryColor: string;
  previewGradient: string;
}

export const ACCENT_THEMES: AccentOption[] = [
  {
    id: 'indigo',
    name: 'Foundry Indigo',
    primaryColor: '#6366f1',
    previewGradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
  },
  {
    id: 'cyan',
    name: 'Cyberpunk Cyan',
    primaryColor: '#06b6d4',
    previewGradient: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
  },
  {
    id: 'emerald',
    name: 'Hacker Emerald',
    primaryColor: '#10b981',
    previewGradient: 'linear-gradient(135deg, #10b981, #059669)',
  },
  {
    id: 'purple',
    name: 'Dracula Violet',
    primaryColor: '#a855f7',
    previewGradient: 'linear-gradient(135deg, #a855f7, #ec4899)',
  },
  {
    id: 'amber',
    name: 'Solarized Amber',
    primaryColor: '#f59e0b',
    previewGradient: 'linear-gradient(135deg, #f59e0b, #ea580c)',
  },
];

interface ThemeContextType {
  colorMode: ColorMode;
  resolvedMode: 'dark' | 'light';
  accentTheme: AccentTheme;
  setColorMode: (mode: ColorMode) => void;
  setAccentTheme: (accent: AccentTheme) => void;
  cycleColorMode: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const COLOR_MODE_KEY = 'jf_theme_mode';
const ACCENT_KEY = 'jf_theme_accent';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [colorMode, setColorModeState] = useState<ColorMode>(() => {
    const saved = localStorage.getItem(COLOR_MODE_KEY);
    if (saved === 'dark' || saved === 'light' || saved === 'system') return saved;
    return 'system';
  });

  const [accentTheme, setAccentThemeState] = useState<AccentTheme>(() => {
    const saved = localStorage.getItem(ACCENT_KEY);
    if (saved && ACCENT_THEMES.some((t) => t.id === saved)) return saved as AccentTheme;
    return 'indigo';
  });

  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true;
  });

  // Watch system preferences
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemDark(e.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const resolvedMode: 'dark' | 'light' =
    colorMode === 'system' ? (systemDark ? 'dark' : 'light') : colorMode;

  // Apply DOM attributes
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    root.setAttribute('data-color-mode', resolvedMode);
    root.setAttribute('data-theme-mode-pref', colorMode);
    root.setAttribute('data-theme-accent', accentTheme);
    root.classList.toggle('dark', resolvedMode === 'dark');
    root.classList.toggle('light', resolvedMode === 'light');
  }, [resolvedMode, colorMode, accentTheme]);

  const setColorMode = useCallback((mode: ColorMode) => {
    setColorModeState(mode);
    localStorage.setItem(COLOR_MODE_KEY, mode);
  }, []);

  const setAccentTheme = useCallback((accent: AccentTheme) => {
    setAccentThemeState(accent);
    localStorage.setItem(ACCENT_KEY, accent);
  }, []);

  const cycleColorMode = useCallback(() => {
    setColorModeState((prev) => {
      let next: ColorMode;
      if (prev === 'system') next = 'dark';
      else if (prev === 'dark') next = 'light';
      else next = 'system';
      localStorage.setItem(COLOR_MODE_KEY, next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        colorMode,
        resolvedMode,
        accentTheme,
        setColorMode,
        setAccentTheme,
        cycleColorMode,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
};
