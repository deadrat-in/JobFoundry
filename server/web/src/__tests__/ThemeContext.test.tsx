import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ThemeProvider, useTheme } from '../context/ThemeContext';

const TestThemeConsumer: React.FC = () => {
  const { colorMode, resolvedMode, accentTheme, setColorMode, setAccentTheme, cycleColorMode } =
    useTheme();

  return (
    <div>
      <span data-testid="color-mode">{colorMode}</span>
      <span data-testid="resolved-mode">{resolvedMode}</span>
      <span data-testid="accent-theme">{accentTheme}</span>
      <button onClick={() => setColorMode('light')}>Set Light</button>
      <button onClick={() => setColorMode('dark')}>Set Dark</button>
      <button onClick={() => setAccentTheme('cyan')}>Set Cyan</button>
      <button onClick={cycleColorMode}>Cycle</button>
    </div>
  );
};

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-color-mode');
    document.documentElement.removeAttribute('data-theme-accent');
  });

  it('provides default theme settings and writes attributes to documentElement', () => {
    render(
      <ThemeProvider>
        <TestThemeConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId('color-mode').textContent).toBe('system');
    expect(screen.getByTestId('accent-theme').textContent).toBe('indigo');
    expect(document.documentElement.getAttribute('data-theme-accent')).toBe('indigo');
    expect(document.documentElement.hasAttribute('data-color-mode')).toBe(true);
  });

  it('allows changing color mode and persists in localStorage', () => {
    render(
      <ThemeProvider>
        <TestThemeConsumer />
      </ThemeProvider>
    );

    act(() => {
      screen.getByText('Set Light').click();
    });

    expect(screen.getByTestId('color-mode').textContent).toBe('light');
    expect(screen.getByTestId('resolved-mode').textContent).toBe('light');
    expect(localStorage.getItem('jf_theme_mode')).toBe('light');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('light');

    act(() => {
      screen.getByText('Set Dark').click();
    });

    expect(screen.getByTestId('color-mode').textContent).toBe('dark');
    expect(screen.getByTestId('resolved-mode').textContent).toBe('dark');
    expect(localStorage.getItem('jf_theme_mode')).toBe('dark');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('dark');
  });

  it('cycles through color modes: system -> dark -> light -> system', () => {
    render(
      <ThemeProvider>
        <TestThemeConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId('color-mode').textContent).toBe('system');

    act(() => {
      screen.getByText('Cycle').click();
    });
    expect(screen.getByTestId('color-mode').textContent).toBe('dark');

    act(() => {
      screen.getByText('Cycle').click();
    });
    expect(screen.getByTestId('color-mode').textContent).toBe('light');

    act(() => {
      screen.getByText('Cycle').click();
    });
    expect(screen.getByTestId('color-mode').textContent).toBe('system');
  });

  it('updates accent theme and reflects in data-theme-accent attribute', () => {
    render(
      <ThemeProvider>
        <TestThemeConsumer />
      </ThemeProvider>
    );

    act(() => {
      screen.getByText('Set Cyan').click();
    });

    expect(screen.getByTestId('accent-theme').textContent).toBe('cyan');
    expect(localStorage.getItem('jf_theme_accent')).toBe('cyan');
    expect(document.documentElement.getAttribute('data-theme-accent')).toBe('cyan');
  });
});
