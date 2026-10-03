/**
 * Running the price capture, and seeing what it did.
 *
 * Only an admin sees this. Only an admin can use it either — the Edge Function checks for
 * itself and refuses anyone else, so hiding this is about not showing people controls
 * that are not theirs, not about keeping them out.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  fetchSyncRuns,
  runPriceSyncToCompletion,
  type PriceSyncResult,
  type SyncRun,
} from '../lib/adminApi';

export function AdminSync() {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PriceSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchSyncRuns().then(setRuns).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(reload, [reload]);

  async function run() {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      await runPriceSyncToCompletion(setProgress);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      reload();
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Price capture</h2>
          <p className="mt-1 max-w-prose text-sm text-[var(--color-text-muted)]">
            Fetches today's price for every card anyone owns or wants. One run serves all
            users — prices are shared, so nobody pays twice for the same card.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? 'Capturing…' : 'Capture prices'}
        </button>
      </div>

      {progress && (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]" role="status" aria-live="polite">
          {progress.note ??
            `Priced ${progress.priced} of ${progress.cardsSeen}, ${progress.changed} price${
              progress.changed === 1 ? '' : 's'
            } moved` +
              (progress.failed ? `, ${progress.failed} failed` : '') +
              (progress.remaining ? ` — ${progress.remaining} to go` : '')}
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <table className="mt-4 w-full text-left text-sm">
        <thead>
          <tr className="text-[var(--color-text-muted)]">
            <th className="pb-2 font-medium">Started</th>
            <th className="pb-2 font-medium">Cards</th>
            <th className="pb-2 font-medium">Prices read</th>
            <th className="pb-2 font-medium">Moved</th>
            <th className="pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-t border-[var(--color-border)]">
              <td className="py-2 text-[var(--color-text-muted)]">
                {new Date(r.startedAt).toLocaleString()}
              </td>
              <td className="py-2 tabular-nums">{r.cardsSeen}</td>
              <td className="py-2 tabular-nums">{r.pricesRead}</td>
              {/* Rarely equal to prices read, and that is the point: most prices do not
                  move from one day to the next, so only the ones that did are stored. */}
              <td className="py-2 tabular-nums">{r.changed}</td>
              <td className="py-2">
                <span
                  className={
                    'rounded-full px-2 py-0.5 text-xs font-medium ' +
                    (r.status === 'success'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                      : r.status === 'running'
                        ? 'bg-sky-500/15 text-sky-700 dark:text-sky-400'
                        : r.status === 'partial'
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                          : 'bg-red-500/15 text-red-700 dark:text-red-400')
                  }
                  title={r.error ?? undefined}
                >
                  {r.status}
                </span>
              </td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-[var(--color-text-muted)]">
                No captures yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
