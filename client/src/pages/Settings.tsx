import { AdminCardArt } from '../components/AdminCardArt';
import { AdminSync } from '../components/AdminSync';
import { SyncCalendar } from '../components/SyncCalendar';
import { SetCoverage } from '../components/SetCoverage';
import { DatabaseMeter } from '../components/DatabaseMeter';
import { PriceHealth } from '../components/PriceHealth';
import { PriceProvenance } from '../components/PriceProvenance';
import { useSession } from '../lib/sessionContext';

export function Settings() {
  const { admin } = useSession();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Everything here is shared data that only an admin refreshes, so for a normal user
          the page has nothing on it at all rather than a row of controls that refuse.

          There is no display-currency control any more. It offered six currencies backed by
          an fx_rates table that held zero rows for its whole life, so it had never once
          converted anything -- it only chose which chart opened first. One source means one
          currency, and a selector that silently does nothing is worse than none. */}
      {!admin && (
        <p className="mt-6 text-sm text-[var(--color-text-muted)]">
          Nothing to configure yet. Your collection and want lists are under your account
          menu.
        </p>
      )}

      {admin && (
        <>
          <PriceHealth />
          <SetCoverage />
          <SyncCalendar />
          <PriceProvenance />
          <DatabaseMeter />
          <AdminSync />
          <AdminCardArt />

          <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-lg font-semibold">Catalogue</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Every Pokémon and card, shared by all users. Loaded once and refreshed when a
              new set appears.
            </p>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-medium text-[var(--color-text)]">Pokémon and cards</dt>
                <dd className="text-[var(--color-text-muted)]">
                  Imported from the project machine with{' '}
                  <code className="rounded bg-[var(--color-bg)] px-1 py-0.5 text-xs">
                    node supabase/scripts/import-catalogue.mjs
                  </code>
                  . Not yet runnable from here.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--color-text)]">Card to product mapping</dt>
                <dd className="text-[var(--color-text-muted)]">
                  Rebuilt with{' '}
                  <code className="rounded bg-[var(--color-bg)] px-1 py-0.5 text-xs">
                    node supabase/scripts/buildPriceMap.mjs
                  </code>
                  {' '}after a new set lands, or nothing in it will ever be priced.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--color-text)]">Set and series artwork</dt>
                <dd className="text-[var(--color-text-muted)]">
                  Downloads and re-encodes images, which needs a filesystem — so it stays a
                  job for the machine that holds them.
                </dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
