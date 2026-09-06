import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

// Drop-in replacement for useState that mirrors its value to localStorage, so filters,
// sort order, search text, page position, and the like survive a refresh or navigating
// away and back — this is a single-user local app, so per-browser storage is the right
// place for "remember how I left this screen," no server round-trip needed.
export function usePersistentState<T>(
  key: string,
  initialValue: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      // corrupted JSON, storage unavailable (private mode, etc.) — fall through to default
    }
    return initialValue instanceof Function ? initialValue() : initialValue;
  });

  // Stable across renders, like the useState setter this stands in for — callers pass it
  // into effect/memo dependency lists, where a fresh identity each render would re-run
  // that work on every single render.
  const setPersistent = useCallback<Dispatch<SetStateAction<T>>>(
    (value) => {
      setState((prev) => {
        const next = value instanceof Function ? (value as (p: T) => T)(prev) : value;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // storage full or unavailable — state still updates in memory for this session
        }
        return next;
      });
    },
    [key],
  );

  return [state, setPersistent];
}
