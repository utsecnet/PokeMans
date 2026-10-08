/**
 * Where the prices come from, which is two parties rather than one.
 *
 * The card page labels its chart "TCGplayer", and that is right: TCGplayer computes the
 * market, low, mid and high, and the figures are theirs. But we do not fetch from TCGplayer,
 * whose API needs a key we do not have. We fetch from a mirror that republishes their daily
 * export.
 *
 * That distinction lived in nine backend files and nowhere a person could see, and it
 * matters because the chain has a failure mode the label hides: if the mirror lags a day,
 * stops updating or drops a set, the chart still says "TCGplayer" with no hedge, and nothing
 * on screen separates TCGplayer's view from a stale copy of it. This panel sits beside the
 * sync calendar because that is where someone already goes when they doubt a number.
 *
 * It belongs on the admin page rather than the chart. A collector looking at a card wants
 * the price; someone asking where the price came from is debugging, and that is this page.
 */
import { useEffect, useState } from 'react';
import { fetchPriceProvenance } from '../lib/adminApi';
import type { PriceProvenance as Provenance } from '../types';

export function PriceProvenance() {
  const [sources, setSources] = useState<Provenance[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPriceProvenance()
      .then((rows) => { if (!cancelled) setSources(rows); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 className="text-lg font-semibold">Where prices come from</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        The chart on a card names the marketplace whose prices these are. It is not always who
        we fetch them from.
      </p>

      {error && <p className="mt-3 text-sm text-[var(--color-text-muted)]">{error}</p>}
      {!sources && !error && (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">Loading…</p>
      )}

      {sources?.map((s) => (
        <div key={s.key} className="mt-4 rounded-lg border border-[var(--color-border)] p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-semibold">{s.label}</span>
            <span className="text-sm text-[var(--color-text-muted)]">
              {s.currency}
              {s.priceBasis ? ` · ${s.priceBasis}` : ''}
            </span>
          </div>

          {/* The chain, stated plainly: who priced it, who carried it, who stored it. */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded bg-[var(--color-surface-raised,rgba(127,127,127,0.12))] px-2 py-1">
              {s.label}
              <span className="ml-1 text-[var(--color-text-muted)]">prices it</span>
            </span>
            <span aria-hidden className="text-[var(--color-text-muted)]">→</span>
            <span className="rounded bg-[var(--color-surface-raised,rgba(127,127,127,0.12))] px-2 py-1">
              {s.feedLabel ?? 'fetched directly'}
              {s.feedLabel && <span className="ml-1 text-[var(--color-text-muted)]">carries it</span>}
            </span>
            <span aria-hidden className="text-[var(--color-text-muted)]">→</span>
            <span className="rounded bg-[var(--color-surface-raised,rgba(127,127,127,0.12))] px-2 py-1">
              PokéMans
              <span className="ml-1 text-[var(--color-text-muted)]">stores it</span>
            </span>
          </div>

          {s.feedUrl && (
            <p className="mt-3 break-all font-mono text-xs text-[var(--color-text-muted)]">
              {s.feedUrl}
            </p>
          )}
          {s.feedNote && (
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">{s.feedNote}</p>
          )}
        </div>
      ))}
    </section>
  );
}
