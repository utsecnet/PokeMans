import { useEffect, useState } from 'react';
import { fetchStorage } from '../lib/api';
import type { StorageReport } from '../types';

/** Sizes span four orders of magnitude here, so the unit has to move with them. */
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Colours for the stacked bar. Fixed per slice rather than derived from the accent, because
 * the bar's whole job is telling slices apart — tints of one hue would make the small ones
 * indistinguishable from each other.
 */
const SLICE_COLORS = [
  '#4a90d9',
  '#5f9c47',
  '#e0b326',
  '#a05fd0',
  '#e2762f',
  '#4aaea0',
  '#8f96a6',
];

export function StorageBreakdown() {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStorage()
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not read storage use'));
  }, []);

  if (error) return <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!report) return <p className="mt-2 text-sm text-[var(--color-text-muted)]">Measuring…</p>;

  const grandTotal = report.databases.reduce((sum, d) => sum + d.onDisk, 0);

  return (
    <div className="mt-3 space-y-5">
      <p className="text-sm text-[var(--color-text-muted)]">
        {formatBytes(grandTotal)} on disk in total.
      </p>

      {report.databases.map((database) => {
        const scale = database.used || 1;
        return (
          <div key={database.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 className="text-sm font-semibold">{database.label}</h3>
              <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                {database.file}
              </span>
            </div>

            <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
              {database.items.map((item, i) => (
                <div
                  key={item.id}
                  title={`${item.label} — ${formatBytes(item.bytes)}`}
                  style={{
                    width: `${(item.bytes / scale) * 100}%`,
                    backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length],
                  }}
                />
              ))}
            </div>

            <ul className="mt-2 space-y-1">
              {database.items.map((item, i) => (
                <li key={item.id} className="flex items-baseline gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }}
                  />
                  <span className="font-medium">{item.label}</span>
                  {item.count > 0 && (
                    <span className="text-[var(--color-text-muted)]">
                      {item.count.toLocaleString()} {item.countLabel}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 tabular-nums">{formatBytes(item.bytes)}</span>
                </li>
              ))}
            </ul>

            {/* The journal and any reclaimed pages are real disk use but not data, so they
                are stated under the list rather than shown as another slice — a 4MB bar
                labelled "write-ahead log" would dominate a 270KB database and say nothing
                about what is being stored. */}
            <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">
              {formatBytes(database.main)} database
              {database.wal > 0 && <> · {formatBytes(database.wal)} write-ahead log</>}
              {database.free > 0 && <> · {formatBytes(database.free)} reusable</>}
            </p>
          </div>
        );
      })}
    </div>
  );
}
