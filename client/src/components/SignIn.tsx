/**
 * Sign in, and who you are once you have.
 *
 * Anonymous visitors see an invitation rather than a demand: everything already works,
 * and signing in is what makes a collection outlive this browser. That framing matters —
 * the collection built before signing in is kept, not replaced, because linking attaches
 * Google to the account they already hold.
 *
 * The exception is a Google account that already belongs to someone here. Both accounts
 * may hold collections and nothing can merge them safely, so it asks instead of choosing.
 */
import { useEffect, useState } from 'react';
import { useSession } from '../lib/sessionContext';
import {
  startGoogleSignIn,
  signInDiscardingAnonymous,
  signOut,
  readOAuthError,
  clearOAuthError,
} from '../lib/auth';

export function SignIn() {
  const { user, anonymous } = useSession();
  const [busy, setBusy] = useState(false);

  // A refusal from the provider comes back on the URL, not as a rejected promise, so it
  // is read on arrival. Read during the first render rather than in an effect: the value
  // is already there in the address bar, and deriving it avoids a second render to show
  // something that was known before the first.
  const [failure] = useState(readOAuthError);
  const [conflict, setConflict] = useState(failure?.code === 'identity_already_exists');
  const [error, setError] = useState<string | null>(
    failure && failure.code !== 'identity_already_exists' ? failure.message : null,
  );

  // Tidying the address bar is the side effect, and the only thing the effect is for.
  useEffect(clearOAuthError, []);

  async function begin() {
    setBusy(true);
    setError(null);
    const outcome = await startGoogleSignIn();
    if (!outcome.ok) {
      setBusy(false);
      if (outcome.reason === 'already-registered') setConflict(true);
      else setError(outcome.message);
    }
    // On success the browser is already navigating to Google; leave the button busy.
  }

  async function beginFresh() {
    setBusy(true);
    setConflict(false);
    const outcome = await signInDiscardingAnonymous();
    if (!outcome.ok) {
      setBusy(false);
      setError(outcome.message);
    }
  }

  if (user && !anonymous) {
    const name =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      user.email ??
      'Signed in';
    const avatar = user.user_metadata?.avatar_url as string | undefined;

    return (
      <div className="flex items-center gap-2">
        {avatar ? (
          <img src={avatar} alt="" className="size-7 rounded-full ring-1 ring-black/10" />
        ) : null}
        <span className="hidden text-sm text-[var(--color-text)] sm:inline">{name}</span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-md px-2 py-1 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
        >
          Sign out
        </button>
      </div>
    );
  }

  if (conflict) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[var(--color-text-muted)]">
          That Google account is already registered here. Signing in to it leaves anything
          added in this browser behind.
        </span>
        <button
          type="button"
          onClick={() => void beginFresh()}
          disabled={busy}
          className="rounded-md bg-[var(--color-accent)] px-2 py-1 font-medium text-white disabled:opacity-60"
        >
          Sign in anyway
        </button>
        <button
          type="button"
          onClick={() => setConflict(false)}
          className="rounded-md px-2 py-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-sm text-[var(--color-danger,#dc2626)]">{error}</span> : null}
      <button
        type="button"
        onClick={() => void begin()}
        disabled={busy}
        title="Your collection stays yours — signing in keeps what you have already added"
        className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] disabled:opacity-60"
      >
        <GoogleMark />
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </div>
  );
}

/** Google's mark, inline — the CSP allows no external images, and this is four paths. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M45 24c0-1.6-.1-2.7-.4-3.9H24v7.1h12c-.2 1.8-1.5 4.6-4.4 6.4l6.7 5.2C42.2 35.1 45 30 45 24z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 9.9l7.1-5.5z" />
      <path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.4 2 8 6.9 4.4 14.1l7.1 5.5c1.8-5.3 6.7-8.9 12.5-8.9z" />
    </svg>
  );
}
