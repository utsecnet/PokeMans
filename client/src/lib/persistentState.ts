import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

// Drop-in replacement for useState that mirrors its value to localStorage, so filters,
// sort order, search text, page position, and the like survive a refresh or navigating
// away and back — this is a single-user local app, so per-browser storage is the right
// place for "remember how I left this screen," no server round-trip needed.
/**
 * Fills in keys a stored value predates.
 *
 * A value written before a field existed comes back without it, and a caller reading, say,
 * `filters.supertypes.length` then throws on a shape that was valid when it was saved. Only
 * plain objects are merged — an array or a primitive is whatever it is, and a missing key is
 * meaningless there.
 *
 * Shallow by design: nested shapes here are arrays of values, not objects with their own
 * growing key sets, so a deep merge would only risk resurrecting entries a user removed.
 */
function reconcile<T>(stored: unknown, fallback: T): T {
  const isPlainObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isPlainObject(stored) || !isPlainObject(fallback)) return stored as T;
  return { ...(fallback as object), ...(stored as object) } as T;
}

export function usePersistentState<T>(
  key: string,
  initialValue: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    const fallback = initialValue instanceof Function ? initialValue() : initialValue;
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return reconcile(JSON.parse(raw), fallback);
    } catch {
      // corrupted JSON, storage unavailable (private mode, etc.) — fall through to default
    }
    return fallback;
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
