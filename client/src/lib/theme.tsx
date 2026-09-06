import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  resolved: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // localStorage unavailable
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Length of the light/dark crossfade. Must match the duration in index.css. */
const THEME_TRANSITION_MS = 2000;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(getStoredPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const isFirstApply = useRef(true);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  const resolved: 'light' | 'dark' = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const root = document.documentElement;
    // Skip the very first run: that one is just applying the stored theme as the page
    // loads, and fading in from the wrong colours would look like a bug rather than a
    // transition.
    if (isFirstApply.current) {
      isFirstApply.current = false;
      root.classList.toggle('dark', resolved === 'dark');
      return;
    }

    // The class goes on before the colours change, so the transition is already in effect
    // when the new values land — otherwise the switch snaps.
    root.classList.add('theme-transition');
    root.classList.toggle('dark', resolved === 'dark');
    const timer = setTimeout(
      () => root.classList.remove('theme-transition'),
      THEME_TRANSITION_MS,
    );
    return () => clearTimeout(timer);
  }, [resolved]);

  const setPreference = (pref: ThemePreference) => {
    setPreferenceState(pref);
    try {
      if (pref === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', pref);
    } catch {
      // localStorage unavailable
    }
  };

  const value = useMemo(() => ({ preference, setPreference, resolved }), [preference, resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
