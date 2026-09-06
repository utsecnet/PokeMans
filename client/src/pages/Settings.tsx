import { useEffect, useState } from 'react';
import {
  fetchDisplayCurrency,
  fetchSyncStatus,
  setDisplayCurrency,
  triggerPokeApiSync,
  triggerPriceSync,
  triggerTcgSync,
} from '../lib/api';
import type { SyncStatus } from '../types';
import { LinkedAccounts } from '../components/LinkedAccounts';

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === 'success'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : status === 'error'
        ? 'bg-red-500/15 text-red-600 dark:text-red-400'
        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{status}</span>;
}

export function Settings() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [supported, setSupported] = useState<string[]>(['USD']);
  const isSyncing = !!syncStatus?.active;

  const loadSyncStatus = () => {
    fetchSyncStatus()
      .then(setSyncStatus)
      .catch(() => {});
  };

  useEffect(() => {
    loadSyncStatus();
    fetchDisplayCurrency()
      .then((res) => {
        setCurrency(res.currency);
        setSupported(res.supported);
      })
      .catch(() => {});
  }, []);

  const changeCurrency = async (next: string) => {
    const previous = currency;
    setCurrency(next);
    try {
      await setDisplayCurrency(next);
    } catch {
      setCurrency(previous);
    }
  };

  // `isSyncing` is a stable boolean, unlike `syncStatus.active` itself — a fresh object
  // reference comes back on every poll even when nothing meaningful changed, which used
  // to re-run this effect on every tick and (since the interval was cleared but the ref
  // tracking it was never reset to null) silently stop polling after the very first one.
  useEffect(() => {
    if (!isSyncing) return;
    const id = setInterval(loadSyncStatus, 1500);
    return () => clearInterval(id);
  }, [isSyncing]);

  const handleTrigger = async (fn: () => Promise<{ started: boolean }>) => {
    setError(null);
    setMessage(null);
    try {
      await fn();
      loadSyncStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start sync');
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="text-lg font-semibold">Data Sync</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Pull the latest species data from PokeAPI, or card images from the pokemon-tcg-data
          dataset. Prices for the cards you own sync automatically on launch, once a day —
          use Refresh prices to update them yourself at any point.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isSyncing}
            onClick={() => handleTrigger(triggerPokeApiSync)}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-50"
          >
            Sync Pokédex data
          </button>
          <button
            type="button"
            disabled={isSyncing}
            onClick={() => handleTrigger(triggerTcgSync)}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-50"
          >
            Sync TCG cards
          </button>
          <button
            type="button"
            disabled={isSyncing}
            onClick={() => handleTrigger(triggerPriceSync)}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-50"
          >
            Refresh prices
          </button>
        </div>

        {message && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {isSyncing && (
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
            Syncing {syncStatus?.active?.source}… this page updates automatically.
          </p>
        )}

        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--color-text-muted)]">
              <th className="pb-2 font-medium">Source</th>
              <th className="pb-2 font-medium">Started</th>
              <th className="pb-2 font-medium">Trigger</th>
              <th className="pb-2 font-medium">Records</th>
              <th className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(syncStatus?.history ?? []).map((entry, i) => (
              <tr key={i} className="border-t border-[var(--color-border)]">
                <td className="py-2 capitalize">{entry.source}</td>
                <td className="py-2 text-[var(--color-text-muted)]">{formatTime(entry.startedAt)}</td>
                <td className="py-2 capitalize text-[var(--color-text-muted)]">
                  {entry.trigger ?? '—'}
                </td>
                <td className="py-2 tabular-nums">{entry.recordsSynced}</td>
                <td className="py-2">
                  <StatusPill status={entry.status} />
                </td>
              </tr>
            ))}
            {(syncStatus?.history ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-[var(--color-text-muted)]">
                  No syncs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="text-lg font-semibold">Display</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Marketplaces quote in their own currencies — TCGplayer in dollars, Cardmarket in
          euros. Prices are converted to the currency you pick here, using the exchange rate
          from each price's own date.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          Currency
          <select
            value={currency}
            onChange={(e) => changeCurrency(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm"
          >
            {supported.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </section>

      <LinkedAccounts />
    </div>
  );
}
