import { useEffect, useState } from 'react';

// Returns `value` delayed until it stops changing for `delayMs`. Used to keep work that
// scales with the dataset — re-filtering the whole bulk-fetched list on the advanced search
// path — off the keystroke path, so typing stays responsive no matter how large the result
// set is. The value is returned as-is on first render, so there's no initial delay.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (Object.is(value, debounced)) return;
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs, debounced]);

  return debounced;
}
