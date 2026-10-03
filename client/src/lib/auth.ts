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
 * Reads a failure Supabase sent back on the return leg of an OAuth round trip.
 *
 * This is the half that matters and is easy to miss. linkIdentity() resolves as soon as
 * the redirect begins — it cannot know whether the provider will accept. A refusal
 * arrives later, as query and fragment parameters on the page the browser lands on, and
 * nothing rejects. The symptom is a sign-in that appears to do nothing: away to Google,
 * back again, still signed out.
 *
 * `identity_already_exists` is the common one: the Google account is already attached to
 * another user here, so it cannot also be attached to this anonymous one. Signing in as
 * that account is the way through, and it means leaving the anonymous session behind.
 *
 * Pure: it reads and returns. Clearing the URL is clearOAuthError, kept separate so this
 * can be called during render without a side effect, and so a double-invoked initialiser
 * in development cannot consume the error before anything displays it.
 */
export function readOAuthError(): { code: string; message: string } | null {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const code = url.searchParams.get('error_code') ?? fragment.get('error_code');
  if (!code) return null;

  const description =
    url.searchParams.get('error_description') ?? fragment.get('error_description') ?? code;

  return { code, message: description.replace(/\+/g, ' ') };
}

/** Drops the error parameters, so a reload does not resurrect one already dealt with. */
export function clearOAuthError(): void {
  const url = new URL(window.location.href);
  if (!url.search && !url.hash) return;
  url.search = '';
  url.hash = '';
  window.history.replaceState({}, '', url.toString());
}

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
