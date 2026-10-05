/**
 * The invitation shown when someone browsing tries to keep something.
 *
 * It appears at the moment of intent, not on arrival. A visitor who has just found a card
 * worth keeping has a reason to sign in; the same words on a landing page are an obstacle
 * between them and the thing they came for.
 *
 * The restriction behind it is not arbitrary. A browsing session exists in one browser's
 * storage and nowhere else, so a collection built in it disappears with cleared site data,
 * a different device, or a private window — silently, and with nobody to ask. Better to
 * say so before the evening's cataloguing than after.
 */
import { useEffect, useRef } from 'react';
import { startGoogleSignIn } from '../lib/auth';

export function SignUpPrompt({ reason, onClose }: { reason: string; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // A dialog that can be tabbed out of is a dialog the screen reader wanders behind.
      if (e.key !== 'Tab' || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>('button, [href]');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    // Stop the page behind scrolling under the scrim.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      // Clicking away dismisses, because this is an invitation and not a toll gate.
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signup-title"
        onClick={(e) => e.stopPropagation()}
        // Full width, capped, centred: a band across the middle rather than a small box.
        className="mx-4 w-full max-w-2xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-7 shadow-2xl sm:p-9"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-7">
          <PokeballMark />

          <div className="min-w-0 flex-1">
            <h2 id="signup-title" className="text-xl font-semibold text-[var(--color-text)] sm:text-2xl">
              Keep what you find
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
              {reason} An account keeps your collection and want lists safe across every
              device — and it stays yours: nothing is shared, and nobody else can see it.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
              It takes one tap, and you can carry on browsing without one.
            </p>
          </div>
        </div>

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={close}
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
          >
            Keep browsing
          </button>
          <button
            type="button"
            onClick={() => void startGoogleSignIn()}
            className="flex items-center justify-center gap-2.5 rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:brightness-110"
          >
            <GoogleMark />
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  );
}

/** Half a pokéball, open — the app's own mark rather than a stock padlock. */
function PokeballMark() {
  return (
    <svg viewBox="0 0 64 64" className="size-14 shrink-0 sm:size-16" aria-hidden="true">
      <circle cx="32" cy="32" r="29" fill="none" stroke="var(--color-accent)" strokeWidth="3" />
      <path d="M3 32h58" stroke="var(--color-accent)" strokeWidth="3" fill="none" />
      <circle cx="32" cy="32" r="9" fill="var(--color-surface)" stroke="var(--color-accent)" strokeWidth="3" />
      <circle cx="32" cy="32" r="3.5" fill="var(--color-accent)" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden="true">
      <path fill="#fff" d="M45 24c0-1.6-.1-2.7-.4-3.9H24v7.1h12c-.2 1.8-1.5 4.6-4.4 6.4l6.7 5.2C42.2 35.1 45 30 45 24z" opacity=".9" />
      <path fill="#fff" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8 41.1 15.4 46 24 46z" opacity=".75" />
      <path fill="#fff" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 9.9l7.1-5.5z" opacity=".6" />
      <path fill="#fff" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.4 2 8 6.9 4.4 14.1l7.1 5.5c1.8-5.3 6.7-8.9 12.5-8.9z" />
    </svg>
  );
}
