import { useEffect, useRef } from 'react';

// Restores scroll position when navigating back to a browsed grid (e.g. clicking into a
// Pokémon, then hitting Back) — filters/page persist via localStorage already, but that
// alone still lands you at the top of the viewport, since the browser doesn't restore
// scroll offset across a client-side route unmount/remount. Session-scoped on purpose:
// this is "where you were a moment ago," not a durable setting.
export function useScrollRestoration(key: string, ready: boolean) {
  const restored = useRef(false);

  // Once the grid actually has content to scroll to, jump back to the saved offset —
  // exactly once per mount, so this never fights normal scrolling during the session.
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const saved = sessionStorage.getItem(key);
    if (saved === null) return;
    const y = Number(saved);
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [ready, key]);

  useEffect(() => {
    let queued = false;
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        try {
          sessionStorage.setItem(key, String(window.scrollY));
        } catch {
          // storage unavailable — scroll restoration just won't work this session
        }
        queued = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [key]);
}
