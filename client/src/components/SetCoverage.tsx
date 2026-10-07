/**
 * Coverage per set, worst first.
 *
 * Every aggregate on this page said the price data was healthy while three whole sets had
 * none at all -- because a set matched to the wrong upstream group is still matched, and its
 * absence only shows when the figure is cut by set.
 *
 * So this defaults to showing the problems and nothing else. A list of two hundred sets is
 * a thing nobody reads; the dozen that are broken is a thing somebody acts on.
 */
import { useEffect, useMemo, useState } from 'react';
import { fetchSetCoverage } from '../lib/adminApi';
import type { SetCoverageRow } from '../types';

/** Below this, a set is worth looking at rather than scrolling past. */
const CONCERN = 80;

function tone(pct: number | null) {
  if (pct === null) return 'var(--color-text-muted)';
  if (pct === 0) return '#d6394a';
  if (pct < 50) return '#d98c1f';
  if (pct < CONCERN) return '#c9a227';
  return '#3f9b52';
}

export function SetCoverage() {
  const [rows, setRows] = useState<SetCoverageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetchSetCoverage().then(setRows).catch((e) => setError(e.message));
  }, []);

  const { shown, concerning, total } = useMemo(() => {
    const all = rows ?? [];
    const withPrintings = all.filter((r) => r.pct !== null);
    const bad = withPrintings.filter((r) => (r.pct ?? 100) < CONCERN);
    return {
      shown: showAll ? all : bad,
      concerning: bad.length,
      total: withPrintings.length,
    };
  }, [rows, showAll]);

  return (
    <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Coverage by set</h2>
        {rows && (
          <span className="text-xs text-[var(--color-text-muted)]">
            {concerning === 0
              ? `all ${total} sets above ${CONCERN}%`
              : `${concerning} of ${total} sets below ${CONCERN}%`}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        A set matched to the wrong upstream group still looks matched, so a healthy total can
        hide a set with nothing at all. This is the figure that shows it.
      </p>

      {error && <p className="mt-3 text-sm text-[var(--color-text-muted)]">{error}</p>}
      {!rows && !error && <p className="mt-3 text-sm text-[var(--color-text-muted)]">Loading…</p>}

      {rows && shown.length === 0 && (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          Nothing below {CONCERN}%.{' '}
          <button type="button" onClick={() => setShowAll(true)} className="underline">
            Show every set
          </button>
        </p>
      )}

      {shown.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-text-muted)]">
              <th className="pb-1 font-normal">Set</th>
              <th className="pb-1 text-right font-normal">Priced</th>
              <th className="pb-1 text-right font-normal">Printings</th>
              <th className="pb-1 text-right font-normal">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.setId} className="border-t border-[var(--color-border)]">
                <td className="py-1.5">
                  <span className="text-[var(--color-text)]">{r.name}</span>
                  <span className="ml-2 text-xs text-[var(--color-text-muted)]">{r.setId}</span>
                </td>
                <td className="py-1.5 text-right tabular-nums text-[var(--color-text-muted)]">
                  {r.priced.toLocaleString()}
                </td>
                <td className="py-1.5 text-right tabular-nums text-[var(--color-text-muted)]">
                  {r.printings.toLocaleString()}
                </td>
                <td
                  className="py-1.5 text-right font-medium tabular-nums"
                  style={{ color: tone(r.pct) }}
                >
                  {r.pct === null ? '—' : `${r.pct}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rows && shown.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-xs text-[var(--color-text-muted)] underline"
        >
          {showAll ? `Show only sets below ${CONCERN}%` : 'Show every set'}
        </button>
      )}
    </section>
  );
}
