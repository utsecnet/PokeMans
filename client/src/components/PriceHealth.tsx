/**
 * Whether the price data itself is sound, as opposed to whether the job ran.
 *
 * These are different questions and the run log only answers the first. A sync can report
 * success every day while covering a third of the catalogue, because the part it misses is
 * the part with no mapping -- and nothing in the calendar would ever show it. Coverage is
 * therefore the headline here.
 *
 * Staleness reads observed_on rather than captured_on: a price that has not moved in six
 * weeks is healthy, a price nobody has looked at in six weeks is not, and only the second
 * is a fault.
 */
import { useEffect, useState } from 'react';
import { fetchPriceHealth } from '../lib/adminApi';
import type { PriceHealthReport } from '../types';

function Figure({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </dd>
      {hint && <p className="text-[11px] text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}

export function PriceHealth() {
  const [h, setH] = useState<PriceHealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPriceHealth().then(setH).catch((e) => setError(e.message));
  }, []);

  const coverage = h && h.totalPrintings
    ? Math.round((h.pricedPrintings / h.totalPrintings) * 100) : 0;
  const freshness = h && h.pricedPrintings
    ? Math.round((h.coveredByLastRun / h.pricedPrintings) * 100) : 0;
  const stale = (h?.daysSinceLastRun ?? 0) > 1;

  return (
    <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 className="text-lg font-semibold">Price health</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Whether the data is sound, which the run log cannot tell you — a job can succeed
        every day while quietly covering only part of the catalogue.
      </p>

      {error && <p className="mt-3 text-sm text-[var(--color-text-muted)]">{error}</p>}
      {!h && !error && <p className="mt-3 text-sm text-[var(--color-text-muted)]">Loading…</p>}

      {h && (
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure
            label="Coverage"
            value={`${coverage}%`}
            hint={`${h.pricedPrintings.toLocaleString()} of ${h.totalPrintings.toLocaleString()} printings`}
            tone={coverage < 70 ? '#d98c1f' : undefined}
          />
          {/* Two separate facts, deliberately. How complete the last run was, and how long
              ago it happened -- folding them into one number made a successful run look
              like a failure for most of every day. */}
          <Figure
            label="Last run covered"
            value={`${freshness}%`}
            hint={h.lastRunOn
              ? h.daysSinceLastRun === 0 ? 'ran today'
                : h.daysSinceLastRun === 1 ? 'ran yesterday'
                : `ran ${h.daysSinceLastRun} days ago`
              : 'never run'}
            tone={freshness < 90 || stale ? '#d98c1f' : undefined}
          />
          <Figure
            label="Stale over 3 days"
            value={h.staleOver3Days.toLocaleString()}
            hint="not seen by a recent run"
            tone={h.staleOver3Days > 0 ? '#d98c1f' : undefined}
          />
          <Figure
            label="History"
            value={h.historyRows.toLocaleString()}
            hint={h.oldestPoint ? `since ${h.oldestPoint}` : 'no points yet'}
          />
        </dl>
      )}
    </section>
  );
}
