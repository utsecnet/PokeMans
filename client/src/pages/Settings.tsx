import { useEffect, useState } from 'react';
import { fetchDisplayCurrency, setDisplayCurrency } from '../lib/api';
import { AdminSync } from '../components/AdminSync';
import { useSession } from '../lib/sessionContext';

export function Settings() {
  const { admin } = useSession();
  const [currency, setCurrency] = useState('USD');
  const [supported, setSupported] = useState<string[]>(['USD']);

  useEffect(() => {
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Catalogue and price data are shared: one copy serves everyone, and only an admin
          refreshes it. A normal user has nothing to sync, so the section does not exist
          for them rather than appearing and refusing.

          The four trigger buttons that used to live here called the local Express server,
          which the hosted app no longer runs — every one of them returned 502. Price
          capture below replaces the one of the four that has moved; the rest are named
          honestly as still being laptop jobs rather than left as controls that fail. */}
      {admin && (
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
                Imported from this machine with{' '}
                <code className="rounded bg-[var(--color-bg)] px-1 py-0.5 text-xs">
                  node supabase/scripts/import-catalogue.mjs
                </code>
                . Not yet runnable from here.
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
      )}

      {admin && <AdminSync />}

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

    </div>
  );
}
