import { useEffect, useMemo, useRef, useState } from 'react';
import { isSignInRequired } from '../lib/signInRequired';
import { Link, useSearchParams } from 'react-router-dom';
import { deleteCollectionBox, deleteWantList } from '../lib/api';
import { useCollection } from '../lib/collectionContext';
import { usePersistentState } from '../lib/persistentState';
import { CollectionIcon } from '../components/CollectionIcon';
import { CollectionIconPicker } from '../components/CollectionIconPicker';
import { useWants } from '../lib/wantContext';
import { createUndoQueue } from '../lib/undoQueue';
import { collectionColorHex } from '../lib/collectionColors';
import { CardFan } from '../components/CardFan';
import { PokeballIcon } from '../components/PokeballIcon';

const UNDO_WINDOW_MS = 6000;

type CollectionSort = 'custom' | 'name' | 'value' | 'cards' | 'created';

const SORTS: { key: CollectionSort; label: string }[] = [
  { key: 'custom', label: 'My order' },
  { key: 'name', label: 'Name' },
  { key: 'value', label: 'Value' },
  { key: 'cards', label: 'Cards' },
  { key: 'created', label: 'Newest' },
];

/**
 * A delete waiting out its undo window. Holds only what the toast and the eventual request
 * need, so collections and want lists — which delete through different endpoints but with
 * identical behaviour — can share one queue rather than duplicating the whole dance.
 */
interface PendingDelete {
  kind: 'collection' | 'want';
  id: number;
  name: string;
}

export function Collection() {
  const { boxes, loading, createBox, refresh, pricesUpdatedAt, setBoxIcon, setBoxColor, reorderBoxes } =
    useCollection();
  // 'custom' is the user's own arrangement; the rest are views over it and leave it intact,
  // so switching to Value to see what is worth most and back doesn't destroy the order.
  const [sortBy, setSortBy] = usePersistentState<CollectionSort>('pokemans.collection.sort', 'custom');
  const [editingIcon, setEditingIcon] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const { lists: wantLists, createList, refresh: refreshWants } = useWants();
  // The tab lives in the URL so a want list's back link returns to the right side, and so
  // the two halves are separately linkable.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'wants' ? 'wants' : 'collections';
  const isWants = tab === 'wants';
  const [newBoxName, setNewBoxName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete[]>([]);
  // The timers live here, not in state. Creating one inside a setState updater is what cost
  // a collection: React runs updaters twice under StrictMode, so two timers were armed and
  // only one was ever cancelled. See lib/undoQueue.
  const undoQueue = useRef(createUndoQueue(UNDO_WINDOW_MS)).current;
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
      if (isWants) await createList(name);
      else await createBox(name);
      setNewBoxName('');
    } catch (err) {
      // The account gate shows its own invitation; an error beside it would be the app
      // objecting to its own suggestion.
      if (isSignInRequired(err)) return;
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
  const handleDeleteClick = (kind: PendingDelete['kind'], id: number, name: string) => {
    const key = `${kind}:${id}`;
    // Arming happens outside any state updater, so it runs exactly once per click.
    const armed = undoQueue.schedule(key, async () => {
      if (kind === 'want') await deleteWantList(id);
      else await deleteCollectionBox(id);
      if (mountedRef.current) {
        setPending((prev) => prev.filter((entry) => `${entry.kind}:${entry.id}` !== key));
      }
      if (kind === 'want') refreshWants();
      else refresh();
    });
    if (!armed) return; // already counting down for this one
    setPending((prev) =>
      prev.some((entry) => entry.kind === kind && entry.id === id)
        ? prev
        : [...prev, { kind, id, name }],
    );
  };

  const handleUndo = (key?: string) => {
    // Disarms the delete first; only then does the toast come down. If this ever fails, the
    // failure is a toast that lingers, not a collection that disappears.
    const target = key ?? undoQueue.armedKeys().at(-1);
    if (!target || !undoQueue.undo(target)) return;
    setPending((prev) => prev.filter((entry) => `${entry.kind}:${entry.id}` !== target));
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

  const pendingKeys = new Set(pending.map((entry) => `${entry.kind}:${entry.id}`));
  const visibleBoxes = boxes.filter((b) => !pendingKeys.has(`collection:${b.id}`));
  const visibleLists = wantLists.filter((l) => !pendingKeys.has(`want:${l.id}`));

  // The server already returns them in the user's order, so 'custom' is simply that order
  // left alone. Every other sort is a copy, so it can't be mistaken for a new arrangement.
  const sortedBoxes = useMemo(() => {
    if (sortBy === 'custom') return visibleBoxes;
    const copy = [...visibleBoxes];
    if (sortBy === 'name') copy.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'value') copy.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
    else if (sortBy === 'cards') copy.sort((a, b) => b.cardCount - a.cardCount);
    else if (sortBy === 'created') copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return copy;
  }, [visibleBoxes, sortBy]);



  /**
   * The order as it would be if the drag ended now. Rendering this rather than the stored
   * order is what makes the other tiles step aside: they are genuinely in their new places
   * while the pointer is still down, so the gap you are about to drop into is visible
   * instead of being described by a line between two tiles.
   */
  /**
   * Where each tile sat when the drag began.
   *
   * Frozen on purpose. Hit-testing against the live DOM is what made this flicker: showing
   * the preview reorders the tiles, which slides a different one under a stationary pointer,
   * which fires dragenter, which reverses the preview — and it oscillates for as long as you
   * hold still. Measuring once means "the pointer is over the third slot" keeps meaning the
   * third slot however the preview rearranges itself underneath.
   */
  const slotsRef = useRef<{ id: number; left: number; top: number; right: number; bottom: number }[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);
  // The same two values as the state above, kept as refs purely for the commit.
  // dragend can arrive in the same React batch as the dragenter that set the final target,
  // and a handler closing over that batch's state still sees the previous target — which on
  // a one-place drag is the tile's own slot, so it concludes nothing moved and silently
  // does nothing. The refs are always current; the state is what renders.
  const dragIdRef = useRef<number | null>(null);
  const overIdRef = useRef<number | null>(null);

  const captureSlots = () => {
    const grid = gridRef.current;
    if (!grid) return;
    slotsRef.current = [...grid.children].flatMap((child) => {
      const id = Number((child as HTMLElement).dataset.boxId);
      if (!Number.isFinite(id)) return [];
      const r = child.getBoundingClientRect();
      return [{ id, left: r.left, top: r.top, right: r.right, bottom: r.bottom }];
    });
  };

  /**
   * Turns a drag event's position into the slot being targeted, and marks the event as a
   * valid drop target. preventDefault is what makes `drop` fire at all; without it the
   * browser treats the grid as un-droppable and only `dragend` arrives.
   */
  const trackPointer = (e: React.DragEvent) => {
    if (dragIdRef.current == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const hit = slotAt(e.clientX, e.clientY);
    if (hit == null) return;
    overIdRef.current = hit;
    if (hit !== overId) setOverId(hit);
  };

  /** Which tile's original slot the pointer is inside, if any. */
  const slotAt = (x: number, y: number) =>
    slotsRef.current.find((s) => x >= s.left && x <= s.right && y >= s.top && y <= s.bottom)?.id ?? null;

  /**
   * The order as it would be if the drag ended now. Rendering this rather than the stored
   * order is what makes the other tiles step aside: they are genuinely in their new places
   * while the pointer is still down, so the gap you are about to drop into is visible
   * instead of being described by a line between two tiles.
   */
  const orderWith = (moved: number | null, target: number | null) => {
    if (moved == null || target == null || moved === target) return null;
    const ids = sortedBoxes.map((b) => b.id);
    const from = ids.indexOf(moved);
    // Deliberately the target's index in the ORIGINAL order, not in the array after the
    // dragged id is pulled out. Taking it afterwards shifts every later index down by one,
    // which silently turns "move one place right" into "stay exactly where you are".
    const to = ids.indexOf(target);
    if (from === -1 || to === -1) return null;
    ids.splice(from, 1);
    ids.splice(to, 0, moved);
    return ids;
  };

  const previewBoxes = useMemo(() => {
    const ids = orderWith(dragId, overId);
    if (!ids) return sortedBoxes;
    const byId = new Map(sortedBoxes.map((b) => [b.id, b]));
    return ids.map((id) => byId.get(id)!).filter(Boolean);
    // orderWith is derived from sortedBoxes; listing it would recreate the memo every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedBoxes, dragId, overId]);

  /** Commits whatever the preview is currently showing. */
  const endDrag = () => {
    const ids = orderWith(dragIdRef.current, overIdRef.current);
    if (ids) reorderBoxes(ids);
    dragIdRef.current = null;
    overIdRef.current = null;
    setDragId(null);
    setOverId(null);
    slotsRef.current = [];
  };

  const totalUnpriced = boxes.reduce((sum, b) => sum + (b.unpriced ?? 0), 0);
  const totalValue = visibleBoxes.reduce((sum, b) => sum + (b.valueUsd ?? 0), 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">{isWants ? 'Want lists' : 'My Collection'}</h1>
        {totalValue > 0 && !isWants && (
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
        {isWants
          ? 'Track the cards you are looking for. A card you already own shows in full colour.'
          : 'Organize the cards you own into separate collections.'}
      </p>

      {/* Two halves of the same page rather than two pages: they share the create form, the
          tile grid and the undo-delete queue, and the only real difference is what a tile
          means — a card you have against one you want. */}
      <div className="mt-4 flex w-full max-w-xs overflow-hidden rounded-lg border border-[var(--color-border)] text-sm">
        {(['collections', 'wants'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setSearchParams(t === 'wants' ? { tab: 'wants' } : {}, { replace: true })}
            aria-pressed={tab === t}
            className={`flex flex-1 items-center justify-center gap-1.5 py-1.5 font-medium transition ${
              tab === t
                ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            <PokeballIcon className="h-4 w-4" strokeWidth={2} dashed={t === 'wants'} />
            {t === 'collections' ? 'Collections' : 'Want lists'}
          </button>
        ))}
      </div>

      <form onSubmit={handleCreate} className="mt-6 flex max-w-md gap-2">
        <input
          type="text"
          value={newBoxName}
          onChange={(e) => setNewBoxName(e.target.value)}
          placeholder={isWants ? 'New want list name…' : 'New collection name…'}
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

      {!isWants && visibleBoxes.length > 1 && (
        <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--color-text-muted)]">Sort</span>
          {SORTS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setSortBy(option.key)}
              aria-pressed={sortBy === option.key}
              className={`rounded-full border px-2.5 py-1 transition ${
                sortBy === option.key
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {option.label}
            </button>
          ))}
          {sortBy === 'custom' && (
            <span className="text-[var(--color-text-muted)]">— drag a tile to rearrange</span>
          )}
        </div>
      )}

      {!loading && !isWants && visibleBoxes.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-[var(--color-text-muted)]">
          Nothing yet. Create one above, or add a card to your collection from any
          Pokémon's trading card gallery.
        </div>
      )}

      {isWants && visibleLists.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-[var(--color-text-muted)]">
          No want lists yet. Create one above, or build one from a filter on the Cards page.
        </div>
      )}

      {isWants && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visibleLists.map((list) => {
            const hex = collectionColorHex(list.color);
            const pct = list.wantedCount > 0 ? (list.ownedCount / list.wantedCount) * 100 : 0;
            return (
              <div
                key={list.id}
                className="group relative isolate rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-center transition hover:-translate-y-0.5 hover:shadow-lg"
                style={hex ? { borderTopColor: hex, borderTopWidth: 3, borderTopStyle: 'solid' } : undefined}
              >
                <button
                  type="button"
                  onClick={() => handleDeleteClick('want', list.id, list.name)}
                  title="Delete want list"
                  className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-muted)] shadow transition hover:border-red-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  ×
                </button>
                <Link to={`/wants/${list.id}`} className="flex flex-col items-center gap-2">
                  {/* The cards themselves, greyed until owned — the same rule the detail page
                      states in words, so the tile reads as progress rather than illustrating
                      a number printed beneath it. */}
                  {list.preview && list.preview.length > 0 ? (
                    <CardFan cards={list.preview.map((p) => ({ url: p.url, dimmed: !p.owned }))} />
                  ) : (
                    <PokeballIcon
                      className={`h-10 w-10 ${hex ? '' : 'text-[var(--color-accent)]'}`}
                      strokeWidth={1.5}
                      dashed
                      style={hex ? { color: hex } : undefined}
                    />
                  )}
                  <span className="font-semibold">{list.name}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {list.ownedCount} of {list.wantedCount} found
                  </span>
                  {/* How close the list is to done, which is the only number a want list
                      really has. */}
                  <span className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: hex ?? 'var(--color-accent)' }}
                    />
                  </span>
                  {list.live && (
                    <span className="text-[10px] text-[var(--color-text-muted)]">follows a filter</span>
                  )}
                </Link>
              </div>
            );
          })}
        </div>
      )}

      <div
        ref={gridRef}
        // One dragover on the container rather than dragenter on every tile: the pointer's
        // position against the frozen slots is the whole input, so a tile moving out from
        // under the cursor can no longer change what is being targeted.
        // dragenter as well as dragover, because dragover is throttled and dragenter is not:
        // crossing two tiles in one sweep can deliver dragenter for both while dragover lands
        // only once, leaving the commit at a position the pointer left long ago — which reads
        // as the tile refusing to move. Listening to both is only safe because the hit test is
        // pointer-against-frozen-slots; keying off the element actually entered is what made
        // this oscillate before.
        onDragEnter={(e) => trackPointer(e)}
        onDragOver={(e) => trackPointer(e)}
        onDrop={(e) => {
          e.preventDefault();
          endDrag();
        }}
        className={`mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5${isWants ? ' hidden' : ''}`}
      >
        {previewBoxes.map((box) => {
          const hex = collectionColorHex(box.color);
          const reorderable = sortBy === 'custom' && visibleBoxes.length > 1;
          return (
            <div
              key={box.id}
              // Dragging is offered only in the user's own order. In a sorted view a drop
              // would have nowhere meaningful to land, and silently switching them back to
              // custom mid-drag would be worse than not accepting the drag.
              data-box-id={box.id}
              draggable={reorderable}
              onDragStart={(e) => {
                // Measured before any preview exists, so the slots describe the resting
                // layout the pointer is being judged against.
                captureSlots();
                dragIdRef.current = box.id;
                overIdRef.current = box.id;
                setDragId(box.id);
                setOverId(box.id);
                // Chrome refuses to start a drag without payload, and the move effect is
                // what gives the pointer a move cursor rather than a copy one.
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(box.id));
              }}
              onDragEnd={endDrag}
              // `isolate` makes each tile its own stacking context, so a z-index on the
              // picker inside one can never lift it above a neighbouring tile — the whole
              // tile has to rise instead. Only while its own picker is open, so tiles keep
              // their normal painting order the rest of the time.
              className={`group relative isolate rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-center transition hover:-translate-y-0.5 hover:shadow-lg ${
                editingIcon === box.id ? 'z-40' : ''
              } ${
                reorderable ? 'cursor-grab active:cursor-grabbing' : ''
              } ${
                dragId === box.id
                  ? 'opacity-40 ring-2 ring-dashed ring-[var(--color-accent)]'
                  : dragId != null && overId === box.id
                    ? 'ring-2 ring-[var(--color-accent)]'
                    : ''
              }`}
              style={hex ? { borderTopColor: hex, borderTopWidth: 3 } : undefined}
            >
              <button
                type="button"
                onClick={() => handleDeleteClick('collection', box.id, box.name)}
                title="Delete collection"
                className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-muted)] shadow transition hover:border-red-400 hover:text-red-600 dark:hover:text-red-400"
              >
                ×
              </button>


              <Link to={`/collection/${box.id}`} className="flex flex-col items-center gap-2">
                {/* What is actually in it. A tile used to show an icon standing for the
                    collection; this shows the collection. */}
                {box.preview && box.preview.length > 0 && (
                  <CardFan cards={box.preview.map((url) => ({ url }))} />
                )}
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

              {/* Overlaid on the placeholder inside the link above: clicking the icon edits
                  its appearance, clicking anywhere else on the tile still opens the box. */}
              <button
                type="button"
                onClick={() => setEditingIcon(editingIcon === box.id ? null : box.id)}
                title="Change icon and colour"
                aria-label={`Change ${box.name} icon`}
                className="absolute left-1.5 top-1.5 z-10 rounded-lg p-1 transition hover:bg-[var(--color-bg)]"
              >
                <CollectionIcon
                  icon={box.icon}
                  color={hex}
                  className={`h-5 w-5 ${hex ? '' : 'text-[var(--color-accent)]'}`}
                />
              </button>

              {editingIcon === box.id && (
                <div className="absolute left-0 top-9 z-30">
                  <CollectionIconPicker
                    icon={box.icon}
                    color={box.color}
                    onPick={(next) => {
                      if (next.icon !== undefined) setBoxIcon(box.id, next.icon);
                      if (next.color !== undefined) setBoxColor(box.id, next.color);
                    }}
                    onClose={() => setEditingIcon(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pending.length > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4">
          {pending.map((entry) => (
            <div
              key={`${entry.kind}:${entry.id}`}
              className="flex items-center gap-3 rounded-lg bg-[var(--color-text)] px-4 py-2 text-sm text-[var(--color-bg)] shadow-lg"
            >
              <span>Deleted "{entry.name}"</span>
              <button
                type="button"
                onClick={() => handleUndo(`${entry.kind}:${entry.id}`)}
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
