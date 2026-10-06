import { Link } from 'react-router-dom';
import { BrowseViewToggle } from './BrowseViewToggle';
import { ThemeToggle } from './ThemeToggle';
import { AccountMenu } from './AccountMenu';

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
        {/* What is left here is about the catalogue, and the same for everyone. Collections
            and settings moved into the account menu: both are yours, and neither means
            anything until there is an account to hold them. */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
