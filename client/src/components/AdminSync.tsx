/**
 * The two jobs an admin can set off by hand.
 *
 * Both normally run on a schedule; these buttons exist for the first run, for catching up
 * after an outage, and for watching the thinning behave before trusting it. The thinning
 * offers a dry run first, because deleting history is the one action here that cannot be
 * undone by running it again.
 */
import { useState } from 'react';
import { runHistoryThinning, runPriceSync, runPriceSyncToCompletion } from '../lib/adminApi';
import type { PriceSyncResult } from '../lib/adminApi';

type Thinning = Awaited<ReturnType<typeof runHistoryThinning>>;

export function AdminSync() {
  const [busy, setBusy] = useState<string | null>(null);
  const [priceResult, setPriceResult] = useState<PriceSyncResult | null>(null);
  const [thinResult, setThinResult] = useState<Thinning | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (name: string, work: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 className="text-lg font-semibold">Run a job now</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Both of these run on a schedule. Use these for a first run, or to catch up after an
        outage.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run('prices', async () => {
            setThinResult(null);
            const r = await runPriceSyncToCompletion(setPriceResult);
            setPriceResult(r);
          })}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === 'prices' ? 'Capturing…' : 'Capture prices'}
        </button>

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run('force', async () => {
            setThinResult(null);
            setPriceResult(await runPriceSync({ force: true }));
          })}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50"
          // The source asks that a day's prices be fetched at most once per day, so a repeat
          // has to be asked for rather than happening by accident.
          title="Re-fetch today's prices even though they have already been captured"
        >
          {busy === 'force' ? 'Re-capturing…' : 'Re-capture today'}
        </button>

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run('thin-dry', async () => {
            setPriceResult(null);
            setThinResult(await runHistoryThinning(true));
          })}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy === 'thin-dry' ? 'Checking…' : 'Preview thinning'}
        </button>

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run('thin', async () => {
            setPriceResult(null);
            setThinResult(await runHistoryThinning(false));
          })}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy === 'thin' ? 'Thinning…' : 'Thin history'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {priceResult && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          {priceResult.skipped ? (
            <p className="col-span-full text-[var(--color-text-muted)]">{priceResult.note}</p>
          ) : (
            <>
              <Row label="Sets fetched" value={priceResult.setsFetched} />
              <Row label="Prices received" value={priceResult.incoming} />
              <Row label="Matched to cards" value={priceResult.resolved} />
              <Row label="Changed" value={priceResult.changed} />
              <Row label="Unchanged" value={priceResult.unchanged} />
              {/* Not a fault. The source publishes the whole Pokemon category — sealed
                  product, Japanese printings, cards this catalogue does not carry. */}
              <Row label="Not in catalogue" value={priceResult.unmapped} />
              {priceResult.failures > 0 && <Row label="Failed sets" value={priceResult.failures} />}
              {priceResult.durationMs != null && (
                <Row label="Took" value={`${(priceResult.durationMs / 1000).toFixed(1)}s`} />
              )}
            </>
          )}
        </dl>
      )}

      {thinResult && (
        <div className="mt-4 text-sm">
          <p className="text-[var(--color-text)]">
            {thinResult.dryRun ? 'Would remove' : 'Removed'}{' '}
            <strong>{thinResult.removed.toLocaleString()}</strong> of{' '}
            {thinResult.before.toLocaleString()} points
            {!thinResult.dryRun && <> — {thinResult.after.toLocaleString()} kept</>}.
          </p>
          <table className="mt-2 w-full text-xs">
            <tbody>
              {thinResult.bands.map((b) => (
                <tr key={b.band} className="border-t border-[var(--color-border)]">
                  <td className="py-1 text-[var(--color-text-muted)]">
                    {b.band} · keep {b.keep}
                  </td>
                  <td className="py-1 text-right tabular-nums">{b.removed.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: number | string | undefined }) {
  if (value == null) return null;
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="tabular-nums text-[var(--color-text)]">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </dd>
    </div>
  );
}
