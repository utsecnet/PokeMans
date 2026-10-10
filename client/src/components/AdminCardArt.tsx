/**
 * Fills in the card thumbnails the bucket does not have yet.
 *
 * The Worker captures a card's art the first time anything asks for it, converting at the
 * edge on the way through, so the gap closes on its own as people browse. This is the
 * deliberate version: find every card still missing, ask for all of them, watch it finish.
 * Worth having because the gap is always the newest set, which is the one set everybody
 * wants to look at the week it lands.
 *
 * Only the 245px thumbnail is filled. The full-size scan stays on demand -- one card in a
 * lightbox is one card, where thumbnails are twenty thousand in a grid.
 */
import { useState } from 'react';
import { fetchCardArtStatus, syncCardArt } from '../lib/adminApi';
import type { CardArtStatus } from '../lib/adminApi';

export function AdminCardArt() {
  const [busy, setBusy] = useState<'checking' | 'syncing' | null>(null);
  const [status, setStatus] = useState<CardArtStatus | null>(null);
  const [progress, setProgress] = useState<{ done: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setBusy('checking');
    setError(null);
    setProgress(null);
    try {
      setStatus(await fetchCardArtStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    if (!status?.cards.length) return;
    setBusy('syncing');
    setError(null);
    setProgress({ done: 0, failed: 0 });
    try {
      await syncCardArt(status.cards, (done, failed) => setProgress({ done, failed }));
      // Re-read rather than assume. A card upstream has never heard of stays missing, and
      // saying "done" over the top of that would be a lie the next run has to discover.
      setStatus(await fetchCardArtStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const total = status?.cards.length ?? 0;
  const pct = progress && total ? Math.round(((progress.done + progress.failed) / total) * 100) : 0;

  return (
    <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 className="text-lg font-semibold">Card art</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Thumbnails are fetched and converted the first time a card is shown. This fills in
        everything still missing in one go, which is usually a set that has just come out.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={check}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy === 'checking' ? 'Checking…' : 'Check for missing art'}
        </button>

        {status && status.missing > 0 && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={sync}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === 'syncing'
              ? `Syncing… ${progress?.done ?? 0} of ${total}`
              : `Sync ${status.missing.toLocaleString()} missing`}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {busy === 'syncing' && (
        <div
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-[var(--color-accent)] transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {status && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <Row label="Cards in catalogue" value={status.total.toLocaleString()} />
          <Row label="Thumbnails held" value={status.present.toLocaleString()} />
          <Row label="Still missing" value={status.missing.toLocaleString()} />
          {progress && progress.failed > 0 && (
            // Not an error worth colouring red. These are cards neither source carries,
            // usually a set listed before its images exist anywhere; the next run picks them
            // up once they do.
            <Row label="No source yet" value={progress.failed.toLocaleString()} />
          )}
        </dl>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--color-border)] py-1 last:border-0">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="font-medium tabular-nums">{value ?? '—'}</dd>
    </div>
  );
}
