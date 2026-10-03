/**
 * The session every query depends on.
 *
 * Nothing in the database is readable without one — the signed-out role holds no policy
 * and no grant — so the app takes an anonymous session before it renders anything that
 * reads. A visitor never sees this happen; they simply arrive at a working catalogue.
 *
 * Children render only once that has resolved, which is a deliberate trade. Rendering
 * first would mean every page firing its queries against no session, getting "permission
 * denied", and showing an error state for the fraction of a second before the session
 * arrives — error flicker on a first visit, for nothing gained.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { ensureSession, isAnonymous, isAdmin as checkAdmin, onAuthChange } from './auth';

interface SessionState {
  session: Session | null;
  user: User | null;
  /** Signed in, but never claimed by a real identity. */
  anonymous: boolean;
  /** May run syncs. Decides whether the admin page exists at all. */
  admin: boolean;
  /** Set when no session could be started — a rate limit, or Supabase unreachable. */
  error: string | null;
}

const SessionContext = createContext<SessionState>({
  session: null,
  user: null,
  anonymous: true,
  admin: false,
  error: null,
});

export function useSession(): SessionState {
  return useContext(SessionContext);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [admin, setAdmin] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const s = await ensureSession();
      if (cancelled) return;
      setSession(s);
      if (!s) setError('Could not start a session. Reload to try again.');
      setReady(true);
    })();

    // Fires on sign-in, sign-out, token refresh and identity linking. Linking is the one
    // that matters most: an anonymous visitor who attaches Google keeps the same user id,
    // so the collection they built is still theirs and nothing needs reloading.
    const stop = onAuthChange((s) => {
      if (!cancelled) setSession(s);
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  // Re-checked whenever the user changes, since signing in is exactly what can turn this
  // from false to true.
  const userId = session?.user?.id;
  const anon = isAnonymous(session?.user);
  useEffect(() => {
    if (!userId || anon) return;
    let cancelled = false;
    void checkAdmin().then((is) => {
      if (!cancelled) setAdmin(is);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, anon]);

  // Derived rather than stored. An anonymous session is never an admin, and clearing the
  // stored flag from inside the effect above would schedule a second render to express
  // something already known during the first.
  const isAdminNow = !anon && admin;

  const value = useMemo<SessionState>(
    () => ({
      session,
      user: session?.user ?? null,
      anonymous: anon,
      admin: isAdminNow,
      error,
    }),
    [session, anon, isAdminNow, error],
  );

  if (!ready) {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-sm text-[var(--color-text-muted)]"
        role="status"
        aria-live="polite"
      >
        Starting…
      </div>
    );
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
