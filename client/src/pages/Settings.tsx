import { Link } from 'react-router-dom';
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

          {/* Inside the admin block, so the link is only drawn for an admin. The page checks
              again on its own, because a route is reachable by typing it. */}
          <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-lg font-semibold">Foil Lab</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              The four foil treatments side by side, on real cards and on one control card.
              For checking a change to the overlays against what the lightbox actually draws.
            </p>
            <Link
              to="/foil-lab"
              className="mt-4 inline-block rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-hover)]"
            >
              Open Foil Lab
            </Link>
          </section>
        </>
      )}
    </div>
  );
}
