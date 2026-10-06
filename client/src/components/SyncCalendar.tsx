/**
 * A year of daily sync outcomes, one small square per day per job.
 *
 * The point of the grid is the gaps. A run that fails is loud -- it errors, and someone
 * notices -- but a run that never fires is silent, and a year of green squares with a quiet
 * hole in March is the only way that becomes visible. So a day with no record is drawn in
 * its own muted colour and is never treated as success.
 */
import { useEffect, useState } from 'react';
import { fetchSyncCalendar } from '../lib/adminApi';
import type { SyncTrack } from '../types';

const STATUS_STYLE: Record<string, { fill: string; title: string }> = {
  ok:    { fill: 'var(--sync-ok)',    title: 'completed' },
  warn:  { fill: 'var(--sync-warn)',  title: 'completed with warnings' },
  error: { fill: 'var(--sync-error)', title: 'failed' },
  none:  { fill: 'var(--sync-none)',  title: 'did not run' },
};

const JOB_NAMES: Record<string, string> = {
  prices: 'Price capture',
  thin: 'History thinning',
};

export function SyncCalendar() {
  const [tracks, setTracks] = useState<SyncTrack[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSyncCalendar(365).then(setTracks).catch((e) => setError(e.message));
  }, []);

  return (
    <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <style>{`
        :root {
          --sync-ok: #3f9b52; --sync-warn: #d98c1f; --sync-error: #d6394a; --sync-none: #e3e3e0;
        }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) { --sync-none: #2c2c2a; }
        }
        :root[data-theme="dark"] { --sync-none: #2c2c2a; }
      `}</style>

      <h2 className="text-lg font-semibold">Daily jobs</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        One square per day for the last year. A blank square is a day the job never ran,
        which is not the same as a day it ran and found nothing.
      </p>

      {error && <p className="mt-3 text-sm text-[var(--color-text-muted)]">{error}</p>}
      {!tracks && !error && (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">Loading…</p>
      )}

      {tracks?.map((track) => (
        <div key={`${track.sourceKey}-${track.job}`} className="mt-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-medium text-[var(--color-text)]">
              {JOB_NAMES[track.job] ?? track.job}
              <span className="ml-2 font-normal text-[var(--color-text-muted)]">{track.label}</span>
            </h3>
            <span className="text-xs text-[var(--color-text-muted)]">
              {track.days.filter((d) => d.status === 'ok').length} of {track.days.length} clear
            </span>
          </div>

          {/* A plain wrapping row rather than a week grid: the question this answers is "has
              it been running", and reading that does not need calendar alignment. It wraps
              to any width, which the GitHub-style seven-row layout does not. */}
          <div className="mt-2 flex flex-wrap gap-[3px]">
            {track.days.map((d) => {
              const style = STATUS_STYLE[d.status] ?? STATUS_STYLE.none;
              const detail = d.status === 'none'
                ? 'did not run'
                : [
                    style.title,
                    d.rows != null ? `${d.rows.toLocaleString()} rows` : null,
                    d.fails ? `${d.fails} failures` : null,
                    d.ms != null ? `${(d.ms / 1000).toFixed(1)}s` : null,
                    d.note,
                  ].filter(Boolean).join(' · ');
              return (
                <span
                  key={d.day}
                  title={`${d.day} — ${detail}`}
                  aria-label={`${d.day}: ${detail}`}
                  className="size-[11px] rounded-[2px]"
                  style={{ background: style.fill }}
                />
              );
            })}
          </div>
        </div>
      ))}

      <div className="mt-4 flex items-center gap-3 text-[11px] text-[var(--color-text-muted)]">
        {(['ok', 'warn', 'error', 'none'] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="size-[11px] rounded-[2px]" style={{ background: STATUS_STYLE[k].fill }} />
            {STATUS_STYLE[k].title}
          </span>
        ))}
      </div>
    </section>
  );
}
