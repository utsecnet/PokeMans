import { UnitToggle } from '../components/UnitToggle';

/**
 * Your settings. Everyone's, including an admin's.
 *
 * This page used to be the admin console for an admin and a sentence for everybody else,
 * which left no room for a preference that belongs to the reader. The console now has its
 * own route and its own row in the account menu, so Settings is one thing: what you have
 * chosen about how the app reads.
 *
 * There is no display-currency control any more. It offered six currencies backed by an
 * fx_rates table that held zero rows for its whole life, so it had never once converted
 * anything — it only chose which chart opened first. One source means one currency, and a
 * selector that silently does nothing is worse than none.
 */
export function Settings() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* The two readings flank the control rather than explaining it in a paragraph: 1m
          and 3ft are the same height said both ways, which is the whole of what the choice
          does. */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-[var(--color-text)]">Measurement units:</span>
        <span className="text-sm text-[var(--color-text-muted)]">1m</span>
        <UnitToggle />
        <span className="text-sm text-[var(--color-text-muted)]">3ft</span>
      </div>
    </div>
  );
}
