import { useEffect, useRef, useState } from 'react';
import {
  fetchSettings,
  fetchSyncStatus,
  removeTcgApiKey,
  saveTcgApiKey,
  triggerPokeApiSync,
  triggerTcgSync,
} from '../lib/api';
import type { SyncStatus } from '../types';

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
  const [tcgApiKeySet, setTcgApiKeySet] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSettings = () => {
    fetchSettings()
      .then((s) => setTcgApiKeySet(s.tcgApiKeySet))
      .catch(() => {});
  };

  const loadSyncStatus = () => {
    fetchSyncStatus()
      .then(setSyncStatus)
      .catch(() => {});
  };

  useEffect(() => {
    loadSettings();
    loadSyncStatus();
  }, []);

  useEffect(() => {
    const isActive = !!syncStatus?.active;
    if (isActive && !pollRef.current) {
      pollRef.current = setInterval(loadSyncStatus, 1500);
    }
    if (!isActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [syncStatus?.active]);

  const handleSaveKey = async () => {
    if (!keyInput.trim()) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await saveTcgApiKey(keyInput.trim());
      setKeyInput('');
      setMessage('API key saved securely.');
      loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save key');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveKey = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await removeTcgApiKey();
      setMessage('API key removed.');
      loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove key');
    } finally {
      setSaving(false);
    }
  };

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

  const isSyncing = !!syncStatus?.active;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="text-lg font-semibold">Pokémon TCG API Key</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Used to sync trading card images. Get a free key at{' '}
          <a
            href="https://dev.pokemontcg.io/"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-accent)] underline"
          >
            dev.pokemontcg.io
          </a>
          . The key is encrypted before being stored in the local database and never leaves
          your machine.
        </p>

        <div className="mt-3 flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${tcgApiKeySet ? 'bg-emerald-500' : 'bg-[var(--color-border)]'}`}
          />
          <span className="text-sm">{tcgApiKeySet ? 'Key saved' : 'No key saved'}</span>
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={tcgApiKeySet ? 'Enter a new key to replace it' : 'Paste your API key'}
            className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <button
            type="button"
            disabled={saving || !keyInput.trim()}
            onClick={handleSaveKey}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-contrast)] disabled:opacity-50"
          >
            Save
          </button>
          {tcgApiKeySet && (
            <button
              type="button"
              disabled={saving}
              onClick={handleRemoveKey}
              className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>

        {message && <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </section>

      <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="text-lg font-semibold">Data Sync</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Pull the latest species data from PokeAPI, or card images from the TCG API.
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
            disabled={isSyncing || !tcgApiKeySet}
            onClick={() => handleTrigger(triggerTcgSync)}
            title={!tcgApiKeySet ? 'Save an API key first' : undefined}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-50"
          >
            Sync TCG cards
          </button>
        </div>

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
              <th className="pb-2 font-medium">Records</th>
              <th className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(syncStatus?.history ?? []).map((entry, i) => (
              <tr key={i} className="border-t border-[var(--color-border)]">
                <td className="py-2 capitalize">{entry.source}</td>
                <td className="py-2 text-[var(--color-text-muted)]">{formatTime(entry.startedAt)}</td>
                <td className="py-2 tabular-nums">{entry.recordsSynced}</td>
                <td className="py-2">
                  <StatusPill status={entry.status} />
                </td>
              </tr>
            ))}
            {(syncStatus?.history ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-[var(--color-text-muted)]">
                  No syncs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
