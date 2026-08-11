import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Light / dark / follow-the-OS, applied as a `dark` class on <html>.
 *
 * A class rather than a media query, because `system` has to be a choice the
 * user can override — and because the studio's `dark:` variant is bound to the
 * class, so nothing flips halfway.
 */
export const themes = ['light', 'dark', 'system'] as const;
export type Theme = (typeof themes)[number];

const STORAGE_KEY = 'workflow-ui-theme';

function readStored(): Theme {
  if (typeof localStorage === 'undefined') return 'system';
  const stored = localStorage.getItem(STORAGE_KEY);
  return themes.find((theme) => theme === stored) ?? 'system';
}

const prefersDark = () =>
  typeof matchMedia === 'undefined' ? false : matchMedia('(prefers-color-scheme: dark)').matches;

/** Runs before React mounts, so the first paint is already the right theme. */
export function applyStoredTheme() {
  const theme = readStored();
  document.documentElement.classList.toggle(
    'dark',
    theme === 'dark' || (theme === 'system' && prefersDark())
  );
}

interface ThemeContextValue {
  /** What the user chose — `system` stays `system`, it does not collapse to the resolved value. */
  theme: Theme;
  /** What that currently means. */
  resolved: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [systemDark, setSystemDark] = useState(prefersDark);

  /* Track the OS only while `system` is selected; an explicit choice ignores it. */
  useEffect(() => {
    if (theme !== 'system' || typeof matchMedia === 'undefined') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    setSystemDark(query.matches);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  return <ThemeContext value={{ theme, resolved, setTheme }}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
