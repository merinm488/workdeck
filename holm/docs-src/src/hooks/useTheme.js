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
  const [theme, setThemeState] = useState('dark');
  const [systemTheme, setSystemTheme] = useState('dark');

  useEffect(() => {
    // Shared suite-wide key; 'docs_theme' is the pre-unification fallback
    const savedTheme = localStorage.getItem('workdeck_theme') || localStorage.getItem('docs_theme') || 'dark';
    setThemeState(savedTheme);

    // Detect system preference
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemTheme(mediaQuery.matches ? 'dark' : 'light');

    // Listen for system theme changes
    const handleChange = (e) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
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

    // A member's suite theme wins over device-local preferences. Public share
    // viewers have no private workspace and keep their local theme.
    fetch('/api/workdeck', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(result => {
        const pref = result?.data?.settings?.theme;
        if (!['light', 'dark', 'system'].includes(pref)) return;
        localStorage.setItem('workdeck_theme', pref);
        setThemeState(pref);
        applyTheme(pref === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : pref);
      }).catch(() => {});

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  /**
   * Apply theme to document
   */
  const applyTheme = (themeValue) => {
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
