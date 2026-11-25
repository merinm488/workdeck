import { useState, useEffect } from 'react';

/**
 * Theme Hook
 *
 * Manages dark/light/system theme switching with:
 * - LocalStorage persistence
 * - System preference detection
 * - CSS class application to <html> element
 */
export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    try { const value = localStorage.getItem('workdeck_theme') || localStorage.getItem('docs_theme'); return ['light', 'dark', 'system'].includes(value) ? value : 'dark'; }
    catch (_) { return 'dark'; }
  });
  const [systemTheme, setSystemTheme] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  useEffect(() => {
    // Shared suite-wide key; 'docs_theme' is the pre-unification fallback
    const storedTheme = localStorage.getItem('workdeck_theme') || localStorage.getItem('docs_theme');
    const savedTheme = ['light', 'dark', 'system'].includes(storedTheme) ? storedTheme : 'dark';
    setThemeState(savedTheme);

    // Detect system preference
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemTheme(mediaQuery.matches ? 'dark' : 'light');

    // Listen for system theme changes
    const handleChange = (e) => {
      const effective = e.matches ? 'dark' : 'light';
      setSystemTheme(effective);
      if (localStorage.getItem('workdeck_theme') === 'system') applyTheme(effective);
    };
    mediaQuery.addEventListener('change', handleChange);

    // Follow theme changes made in other Workdeck tabs
    const handleStorage = (e) => {
      if (e.key !== 'workdeck_theme' || !e.newValue) return;
      const pref = e.newValue;
      if (pref !== 'light' && pref !== 'dark' && pref !== 'system') return;
      setThemeState(pref);
      applyTheme(pref === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : pref);
    };
    window.addEventListener('storage', handleStorage);

    // Apply initial theme
    applyTheme(savedTheme === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : savedTheme);

    // Auth already returns the suite theme. Do not fetch every app's records
    // just to choose a palette (or fetch private data for public share readers).
    const handleSession = event => {
      const pref = event.detail?.member?.theme;
      if (!['light', 'dark', 'system'].includes(pref)) return;
      localStorage.setItem('workdeck_theme', pref);
      setThemeState(pref);
      applyTheme(pref === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : pref);
    };
    window.addEventListener('wd:session', handleSession);

    return () => {
      window.removeEventListener('wd:session', handleSession);
      mediaQuery.removeEventListener('change', handleChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  /**
   * Apply theme to document
   */
  const applyTheme = (themeValue) => {
    document.documentElement.setAttribute('data-theme', themeValue);
    if (themeValue === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  /**
   * Set theme and save to localStorage
   */
  const setTheme = (newTheme) => {
    if (!['light', 'dark', 'system'].includes(newTheme)) return;
    setThemeState(newTheme);
    localStorage.setItem('workdeck_theme', newTheme);
    fetch('/api/workdeck', { method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateSettings', data: { settings: { theme: newTheme } } }),
    }).catch(() => {});

    // Apply the appropriate theme
    if (newTheme === 'system') {
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(systemPrefersDark ? 'dark' : 'light');
    } else {
      applyTheme(newTheme);
    }
  };

  /**
   * Get the actual theme being applied (resolves 'system' to 'dark' or 'light')
   */
  const getEffectiveTheme = () => {
    if (theme === 'system') {
      return systemTheme;
    }
    return theme;
  };

  return { theme, systemTheme, setTheme, getEffectiveTheme };
}
