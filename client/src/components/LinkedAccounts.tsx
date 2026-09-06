import { useEffect, useState } from 'react';
import { fetchLinkedAccounts, removeLinkedAccount, saveLinkedAccount } from '../lib/api';
import type { LinkedAccount } from '../types';

// One block per external service. The list is driven entirely by what the server returns,
// so adding a provider server-side makes it appear here with no change to this file.
function AccountRow({
  provider,
  onChanged,
}: {
  provider: LinkedAccount;
  onChanged: (providers: LinkedAccount[]) => void;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await saveLinkedAccount(provider.id, key.trim());
      onChanged(res.providers);
      setMessage(res.message ?? 'Linked.');
      setKey('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that key');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!confirm(`Remove your ${provider.name} key?`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await removeLinkedAccount(provider.id);
      onChanged(res.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that key');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{provider.name}</h3>
          {provider.linked ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              linked
            </span>
          ) : (
            <span className="rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
              not linked
            </span>
          )}
        </div>
        <a
          href={provider.signupUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[var(--color-accent)] hover:underline"
        >
          Get a key ↗
        </a>
      </div>

      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{provider.summary}</p>

      {provider.linked ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs">{provider.keyHint}</span>
          {provider.lastVerifiedAt && (
            <span className="text-xs text-[var(--color-text-muted)]">
              verified {new Date(provider.lastVerifiedAt).toLocaleDateString()}
            </span>
          )}
          <button
            type="button"
            onClick={unlink}
            disabled={busy}
            className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
          >
            Remove key
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={provider.keyPlaceholder}
            aria-label={`${provider.name} ${provider.keyLabel}`}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 font-mono text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <button
            type="button"
            onClick={save}
            disabled={busy || !key.trim()}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Link'}
          </button>
        </div>
      )}

      {message && <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{message}</p>}
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function LinkedAccounts() {
  const [providers, setProviders] = useState<LinkedAccount[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchLinkedAccounts()
      .then((res) => setProviders(res.providers))
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not load services'));
  }, []);

  return (
    <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 className="text-lg font-semibold">Link Accounts</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Connect your own accounts on other services to pull in data they provide. Keys are
        encrypted before they're stored, and are never shown again once saved.
      </p>

      {loadError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{loadError}</p>}

      <div className="mt-3 space-y-3">
        {providers.map((p) => (
          <AccountRow key={p.id} provider={p} onChanged={setProviders} />
        ))}
      </div>
    </section>
  );
}
