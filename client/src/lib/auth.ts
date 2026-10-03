/**
 * Signing in, and the one subtlety that makes the whole arrangement work.
 *
 * Nobody is asked to create an account to look around. On first load the app quietly
 * takes an *anonymous* session: a real user row, a real token, row level security applied
 * exactly as for anyone else — the visitor simply never filled in a form. That is what
 * lets the catalogue be readable without being public. The signed-out role can reach
 * nothing at all, so there is no endpoint to script against without first holding an
 * account, and accounts are rate limited.
 *
 * The subtlety is what happens when such a visitor decides to keep a collection. The
 * obvious call, signInWithOAuth, signs them in as a *different* user and silently strands
 * everything they just did. The right call is linkIdentity, which attaches Google to the
 * account they already have, so the collection they built while browsing is simply still
 * theirs. See startGoogleSignIn below.
 */
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

/** A session that exists but was never claimed by a real identity. */
export function isAnonymous(user: User | null | undefined): boolean {
  return Boolean(user?.is_anonymous);
}

/**
 * Guarantees a session exists, taking an anonymous one if needed.
 *
 * Safe to call on every load: an existing session is returned untouched, so a returning
 * visitor keeps the same anonymous account — and therefore the same collection — rather
 * than being issued a fresh one each time.
 */
export async function ensureSession(): Promise<Session | null> {
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session) return existing.session;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    // Hitting the signup rate limit, or a captcha challenge, lands here. The app still
    // has to render; it will simply have nothing to show until a session exists.
    console.warn('[auth] could not start an anonymous session:', error.message);
    return null;
  }
  return data.session;
}

export type SignInOutcome =
  | { ok: true; linked: boolean }
  | { ok: false; reason: 'already-registered' | 'failed'; message: string };

/**
 * Begins a Google sign-in, preserving anything done anonymously where it can.
 *
 * Both branches redirect away from the page, so a resolved promise here means the
 * redirect is underway, not that sign-in succeeded.
 *
 * `already-registered` is the case worth handling in the UI: the visitor browsed
 * anonymously, built something, and then offered a Google account that is *already* its
 * own user here. The two cannot be merged automatically — both sides may hold
 * collections, and silently discarding either would be worse than asking. Tell them
 * plainly that signing in will leave the browsing session's work behind.
 */
export async function startGoogleSignIn(redirectTo = window.location.href): Promise<SignInOutcome> {
  const { data: current } = await supabase.auth.getUser();

  if (isAnonymous(current.user)) {
    const { error } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo },
    });
    if (!error) return { ok: true, linked: true };

    // Supabase refuses the link when that Google account already belongs to someone here.
    if (/already|exists|registered|conflict/i.test(error.message)) {
      return { ok: false, reason: 'already-registered', message: error.message };
    }
    return { ok: false, reason: 'failed', message: error.message };
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) return { ok: false, reason: 'failed', message: error.message };
  return { ok: true, linked: false };
}

/**
 * Signs in with Google as a new identity, abandoning the current anonymous session.
 *
 * Only for the `already-registered` case above, and only once the person has been told
 * what they are leaving behind.
 */
export async function signInDiscardingAnonymous(
  redirectTo = window.location.href,
): Promise<SignInOutcome> {
  await supabase.auth.signOut();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) return { ok: false, reason: 'failed', message: error.message };
  return { ok: true, linked: false };
}

/**
 * Signs out, then takes a fresh anonymous session.
 *
 * Without the second step the app would be left with no session at all, and since nothing
 * is readable without one, every screen would empty out — which looks like a failure
 * rather than a sign-out.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  await ensureSession();
}

/** True when the signed-in user may run syncs. Decides whether the admin page exists. */
export async function isAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) {
    console.warn('[auth] admin check failed:', error.message);
    return false;
  }
  return data === true;
}

/** Fires on sign-in, sign-out, token refresh and identity linking. */
export function onAuthChange(fn: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => fn(session));
  return () => data.subscription.unsubscribe();
}
