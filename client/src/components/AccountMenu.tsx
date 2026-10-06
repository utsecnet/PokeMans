/**
 * Who you are, and everything that belongs to you, behind one control.
 *
 * Collections and settings used to sit in the top bar as bare icons. They are both
 * *yours* — one holds your cards, the other your preferences — so they belong with your
 * account rather than beside the browse controls, which are about the catalogue and the
 * same for everyone.
 *
 * Signed out there is nothing to put in a menu, so this is the sign-in button instead.
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../lib/sessionContext';
import { signOut } from '../lib/auth';
import { useAnchoredPopover } from '../lib/useAnchoredPopover';
import { PokeballIcon } from './PokeballIcon';
import { PortalPopoverPanel } from './PortalPopoverPanel';
import { SignIn } from './SignIn';

const MENU_WIDTH = 240;

export function AccountMenu() {
  const { user, anonymous, admin } = useSession();

  // Rendered through a portal rather than inside the header. The header is sticky with a
  // z-index, which makes it a stacking context — so a menu nested in it cannot paint above
  // anything the page puts at a higher layer, however large its own z-index. The page has
  // several: filter popovers at 30, the collection's icon picker at 40, the lightbox at 50.
  // Raising the header instead would put it over the lightbox and the sign-up dialog,
  // which are meant to cover everything.
  //
  // useAnchoredPopover also brings the outside-click handling and viewport clamping this
  // had its own copy of.
  const { open, setOpen, triggerRef, popoverRef, coords } =
    useAnchoredPopover<HTMLButtonElement>(MENU_WIDTH, 260);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Nothing to hang a menu on until there is an account.
  if (!user || anonymous) return <SignIn />;

  const name =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email ??
    'Signed in';
  const avatar = user.user_metadata?.avatar_url as string | undefined;
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        className="flex items-center rounded-full ring-1 ring-[var(--color-border)] transition hover:ring-[var(--color-accent)]"
      >
        {avatar ? (
          <img src={avatar} alt="" className="size-8 rounded-full" />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full bg-[var(--color-accent)] text-sm font-semibold text-white">
            {initial}
          </span>
        )}
      </button>

      {open && coords && (
        <PortalPopoverPanel
          popoverRef={popoverRef}
          coords={coords}
          width={MENU_WIDTH}
          className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        >
          <div role="menu">
          {/* The name sits under the avatar rather than beside it in the bar: it is who
              the menu belongs to, not a control, and in the bar it was competing with
              them for width on a narrow screen. */}
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <p className="truncate text-sm font-medium text-[var(--color-text)]">{name}</p>
            {user.email && user.email !== name && (
              <p className="truncate text-xs text-[var(--color-text-muted)]">{user.email}</p>
            )}
            {admin && (
              <span className="mt-1.5 inline-block rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
                Admin
              </span>
            )}
          </div>

          <nav className="py-1">
            <Item to="/collection" onGo={() => setOpen(false)}>
              <PokeballIcon className="size-4" />
              My Collection
            </Item>
            <Item to="/settings" onGo={() => setOpen(false)}>
              <GearIcon />
              Settings
            </Item>
          </nav>

          <div className="border-t border-[var(--color-border)] py-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
            >
              <SignOutIcon />
              Sign out
            </button>
          </div>
          </div>
        </PortalPopoverPanel>
      )}
    </>
  );
}

function Item({ to, onGo, children }: { to: string; onGo: () => void; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onGo}
      className="flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
    >
      {children}
    </Link>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 16l4-4m0 0l-4-4m4 4H9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 20H6a2 2 0 01-2-2V6a2 2 0 012-2h3" />
    </svg>
  );
}
