/**
 * How much of the free tier the database is using.
 *
 * Worth a panel of its own because the limit is a hard stop, not a bill: past 500 MB the
 * writes fail and the price capture simply stops recording, with nothing in the app to say
 * why. The bar turns amber well before that so it is a decision rather than an incident.
 */
import { useEffect, useState } from 'react';
import { fetchDatabaseUsage } from '../lib/adminApi';
import type { DatabaseUsage } from '../types';

const WARN_AT = 70;
const DANGER_AT = 85;

export function DatabaseMeter() {
  const [usage, setUsage] = useState<DatabaseUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDatabaseUsage().then(setUsage).catch((e) => setError(e.message));
  }, []);

  const pct = usage?.pctUsed ?? 0;
  const tone = pct >= DANGER_AT ? '#d6394a' : pct >= WARN_AT ? '#d98c1f' : '#3f9b52';

  return (
    <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 className="text-lg font-semibold">Storage</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        The database only. File storage and bandwidth are counted separately and are not
        what price history consumes.
      </p>

      {error && <p className="mt-3 text-sm text-[var(--color-text-muted)]">{error}</p>}
      {!usage && !error && <p className="mt-3 text-sm text-[var(--color-text-muted)]">Loading…</p>}

      {usage && (
        <>
          <div className="mt-4 flex items-baseline justify-between text-sm">
            <span className="font-medium text-[var(--color-text)]">
              {usage.pretty} of {usage.limitPretty}
            </span>
            <span style={{ color: tone }} className="font-medium">{usage.pctUsed}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--color-bg)]">
            <div
              className="h-full rounded-full transition-[width]"
              style={{ width: `${Math.min(100, pct)}%`, background: tone }}
            />
          </div>

          {pct >= WARN_AT && (
            <p className="mt-2 text-xs" style={{ color: tone }}>
              Approaching the limit. Past it, writes fail rather than cost money — the price
              capture would stop recording.
            </p>
          )}

          <table className="mt-4 w-full text-sm">
            <tbody>
              {usage.tables.map((t) => (
                <tr key={t.name} className="border-t border-[var(--color-border)]">
                  <td className="py-1.5 text-[var(--color-text-muted)]">{t.name}</td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--color-text)]">{t.pretty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
