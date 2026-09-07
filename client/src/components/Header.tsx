import { Link } from 'react-router-dom';
import { BrowseViewToggle } from './BrowseViewToggle';
import { ThemeToggle } from './ThemeToggle';
import { PokeballIcon } from './PokeballIcon';

export function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur">
      {/* Matches the browse page's max-w-7xl so the switch lines up with the content it
          drives — the filter panel's left edge and the grid's right edge. */}
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          {/* Below sm the browse switch is the more useful of the two, and the row can't
              hold both — the switch's "Pokémon" tab returns you home from anywhere. */}
          <Link to="/" className="hidden shrink-0 items-center gap-2 sm:flex">
            <span className="text-xl font-bold tracking-tight">
              Poké<span className="text-[var(--color-accent)]">Mans</span>
            </span>
          </Link>
          <BrowseViewToggle />
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          <Link
            to="/collection"
            title="My Collection"
            className="rounded-full p-2 text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
          >
            <PokeballIcon className="h-5 w-5" />
          </Link>
          <Link
            to="/settings"
            title="Settings"
            className="rounded-full p-2 text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-5 w-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
