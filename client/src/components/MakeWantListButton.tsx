import { useState } from 'react';
import { isSignInRequired } from '../lib/signInRequired';
import { useNavigate } from 'react-router-dom';
import { cardFilterParams } from '../lib/api';
import { useWants } from '../lib/wantContext';
import { COLLECTION_COLORS } from '../lib/collectionColors';
import type { CardFilters } from '../types';

/**
 * Turns the filter currently applied to the browser into a want list.
 *
 * The filter is stored alongside the cards it matched, so the list can be re-run later.
 * "Keep following" is what decides whether it is: off, the list is a snapshot and only
 * changes when you change it; on, cards printed after today that match will join it on
 * their own. Off is the default because a list that silently grows is the surprising
 * behaviour, and it can be switched on afterwards from the list itself.
 */
export function MakeWantListButton({
  filters,
  matchCount,
}: {
  filters: CardFilters;
  matchCount: number;
}) {
  const { createList } = useWants();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const query = cardFilterParams(filters).toString();
      const list = await createList(trimmed, color, query, live);
      setOpen(false);
      setName('');
      navigate(`/wants/${list.id}`);
    } catch (err) {
      // The account gate shows its own invitation; an error beside it would be the app
      // objecting to its own suggestion.
      if (isSignInRequired(err)) return;
      setError(err instanceof Error ? err.message : 'Could not create the want list');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-dashed border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
      >
        Make a want list from this filter
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
    >
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Want list name…"
        className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
      />
      <div className="flex flex-wrap gap-1">
        {COLLECTION_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            title={c.label}
            onClick={() => setColor(color === c.key ? null : c.key)}
            className={`h-4 w-4 rounded-full transition ${
              color === c.key
                ? 'ring-2 ring-offset-1 ring-[var(--color-text)] ring-offset-[var(--color-surface)]'
                : ''
            }`}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
      <label
        className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]"
        title="Re-run this filter later and add anything new that matches"
      >
        <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
        Keep following
      </label>
      <button
        type="submit"
        disabled={!name.trim() || busy}
        className="rounded bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-[var(--color-accent-contrast)] disabled:opacity-50"
      >
        {busy ? 'Adding…' : `Add ${matchCount}`}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded border border-[var(--color-border)] px-2 py-1 text-xs"
      >
        Cancel
      </button>
      {error && <p className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>}
    </form>
  );
}
