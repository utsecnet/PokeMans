import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteCollectionBox } from '../lib/api';
import { useCollection } from '../lib/collectionContext';
import { collectionColorHex } from '../lib/collectionColors';
import type { CollectionBox } from '../types';
import { PokeballIcon } from '../components/PokeballIcon';

const UNDO_WINDOW_MS = 6000;

interface PendingDelete {
  box: CollectionBox;
  timeoutId: ReturnType<typeof setTimeout>;
}

export function Collection() {
  const { boxes, loading, createBox, refresh, pricesUpdatedAt } = useCollection();
  const [newBoxName, setNewBoxName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete[]>([]);
  const mountedRef = useRef(true);

  // Re-read on arrival rather than trusting what the context last saw. Values move for
  // reasons this page never hears about — a printing named in a box, a price captured by
  // opening a card, the daily sync — and the totals here are the first place that shows.
  useEffect(() => {
    refresh();
    // Deliberately mount-only: refresh replaces `boxes`, so depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newBoxName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      await createBox(name);
      setNewBoxName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create collection');
    } finally {
      setCreating(false);
    }
  };

  // Deleting hides the tile immediately and only actually removes it once the undo
  // window elapses — that way Undo (button or Ctrl+Z) never has to reverse a real
  // deletion, it just cancels the pending one.
  //
  // Guards against a double-click on the × button (both clicks can land before React
  // re-renders and removes it from the DOM): checked and added within the same functional
  // update so two back-to-back calls can't both pass the check, which would otherwise
  // create two independent pending-deletes for the same box — a duplicate toast, and an
  // Undo click that only cancels one of them while the other still deletes it.
  const handleDeleteClick = (box: CollectionBox) => {
    setPending((p) => {
      if (p.some((entry) => entry.box.id === box.id)) return p;
      const timeoutId = setTimeout(async () => {
        await deleteCollectionBox(box.id);
        if (mountedRef.current) {
          setPending((prev) => prev.filter((entry) => entry.box.id !== box.id));
        }
        refresh();
      }, UNDO_WINDOW_MS);
      return [...p, { box, timeoutId }];
    });
  };

  const handleUndo = (boxId?: number) => {
    setPending((p) => {
      if (p.length === 0) return p;
      const idx = boxId !== undefined ? p.findIndex((entry) => entry.box.id === boxId) : p.length - 1;
      if (idx === -1) return p;
      clearTimeout(p[idx].timeoutId);
      return p.filter((_, i) => i !== idx);
    });
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (pending.length === 0) return;
      e.preventDefault();
      handleUndo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pending]);

  const pendingIds = new Set(pending.map((entry) => entry.box.id));
  const visibleBoxes = boxes.filter((b) => !pendingIds.has(b.id));

  const totalUnpriced = boxes.reduce((sum, b) => sum + (b.unpriced ?? 0), 0);
  const totalValue = visibleBoxes.reduce((sum, b) => sum + (b.valueUsd ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">My Collection</h1>
        {totalValue > 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">
            Estimated value{' '}
            <span className="text-base font-semibold tabular-nums text-[var(--color-text)]">
              ${totalValue.toFixed(2)}
            </span>
            {pricesUpdatedAt && (
              <span className="ml-1 text-xs">
                · priced {new Date(pricesUpdatedAt).toLocaleDateString()}
              </span>
            )}
            {/* Stated rather than folded in silently: the total covers only copies whose
                printing is known, and the gap is the owner's to close. */}
            {totalUnpriced > 0 && (
              <span className="ml-1 text-xs">
                · {totalUnpriced} without a printing set
              </span>
            )}
          </p>
        )}
      </div>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Organize the cards you own into separate collections.
      </p>

      <form onSubmit={handleCreate} className="mt-6 flex gap-2">
        <input
          type="text"
          value={newBoxName}
          onChange={(e) => setNewBoxName(e.target.value)}
          placeholder="New collection name…"
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="submit"
          disabled={!newBoxName.trim() || creating}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-contrast)] disabled:opacity-50"
        >
          Create
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!loading && visibleBoxes.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-[var(--color-text-muted)]">
          Nothing yet. Create one above, or add a card to your collection from any
          Pokémon's trading card gallery.
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {visibleBoxes.map((box) => {
          const hex = collectionColorHex(box.color);
          return (
            <div
              key={box.id}
              className="group relative isolate rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-center transition hover:-translate-y-0.5 hover:shadow-lg"
              style={hex ? { borderTopColor: hex, borderTopWidth: 3 } : undefined}
            >
              <button
                type="button"
                onClick={() => handleDeleteClick(box)}
                title="Delete collection"
                className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-muted)] shadow transition hover:border-red-400 hover:text-red-600 dark:hover:text-red-400"
              >
                ×
              </button>
              <Link to={`/collection/${box.id}`} className="flex flex-col items-center gap-2">
                <PokeballIcon
                  className={`h-10 w-10 ${hex ? '' : 'text-[var(--color-accent)]'}`}
                  strokeWidth={1.5}
                  style={hex ? { color: hex } : undefined}
                />
                <span className="font-semibold">{box.name}</span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {box.cardCount} card{box.cardCount === 1 ? '' : 's'}
                  {box.totalQuantity !== box.cardCount ? ` · ${box.totalQuantity} total` : ''}
                </span>
                {box.valueUsd > 0 && (
                  <span className="text-xs font-medium tabular-nums">
                    ${box.valueUsd.toFixed(2)}
                  </span>
                )}
              </Link>
            </div>
          );
        })}
      </div>

      {pending.length > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4">
          {pending.map((entry) => (
            <div
              key={entry.box.id}
              className="flex items-center gap-3 rounded-lg bg-[var(--color-text)] px-4 py-2 text-sm text-[var(--color-bg)] shadow-lg"
            >
              <span>Deleted "{entry.box.name}"</span>
              <button
                type="button"
                onClick={() => handleUndo(entry.box.id)}
                className="font-semibold underline"
              >
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
