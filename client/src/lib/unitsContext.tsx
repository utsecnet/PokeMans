import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { fetchUnitSystem, saveUnitSystem } from './settingsApi';
import { useSession } from './sessionContext';
import type { UnitSystem } from './units';

/**
 * Which units this account reads heights and weights in.
 *
 * The account holds it, in user_settings, so the choice follows the person to a phone, a
 * second browser and a reinstall rather than living on one machine. localStorage still
 * holds a copy, but only as a cache: the account is the source of truth, and the cache
 * exists so the first paint after a reload is in the units already chosen instead of
 * flashing metric for as long as the fetch takes.
 *
 * Metric is the default, because it is what the source publishes and what the app showed
 * before there was a choice.
 */
interface UnitsContextValue {
  system: UnitSystem;
  setSystem: (system: UnitSystem) => void;
}

const UnitsContext = createContext<UnitsContextValue | null>(null);

const CACHE_KEY = 'units';

function readCache(): UnitSystem {
  try {
    if (localStorage.getItem(CACHE_KEY) === 'imperial') return 'imperial';
  } catch {
    // localStorage unavailable
  }
  return 'metric';
}

function writeCache(system: UnitSystem) {
  try {
    // The default leaves nothing behind, so a stored value always means somebody chose.
    if (system === 'metric') localStorage.removeItem(CACHE_KEY);
    else localStorage.setItem(CACHE_KEY, system);
  } catch {
    // localStorage unavailable
  }
}

export function UnitsProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  // The id rather than the user: the session object is replaced on every token refresh, and
  // re-reading a preference every hour because a token rolled over is work for nothing.
  const userId = user?.id ?? null;
  const [system, setSystemState] = useState<UnitSystem>(readCache);

  // Keyed on the account, so signing in as somebody else reads their choice rather than
  // keeping the last person's. An account that has never chosen leaves the cached value
  // alone: that is what this browser was last told, and it beats overruling it with a
  // default nobody picked.
  useEffect(() => {
    if (!userId) return;
    let current = true;
    void fetchUnitSystem().then((stored) => {
      if (!current || !stored) return;
      setSystemState(stored);
      writeCache(stored);
    });
    return () => {
      current = false;
    };
  }, [userId]);

  const setSystem = useCallback(
    (next: UnitSystem) => {
      setSystemState(next);
      writeCache(next);
      // Signed out there is no row to write and nobody to own it, so the choice lives in
      // this browser until there is an account. The save is not awaited: a preference that
      // makes a toggle wait on a round trip feels broken.
      if (userId) void saveUnitSystem(next);
    },
    [userId],
  );

  const value = useMemo(() => ({ system, setSystem }), [system, setSystem]);

  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

export function useUnits(): UnitsContextValue {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error('useUnits must be used within UnitsProvider');
  return ctx;
}
