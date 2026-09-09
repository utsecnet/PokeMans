import { useEffect, useState } from 'react';
import { CardImage } from '../components/CardImage';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  moveCollectionEntry,
  deleteCollectionBox,
  fetchCollectionBox,
  removeCollectionEntry,
  renameCollectionBox,
  setCollectionEntryVariant,
} from '../lib/api';
import { useCollection } from '../lib/collectionContext';
import { CardLightbox } from '../components/CardLightbox';
import { collectionColorHex } from '../lib/collectionColors';
import type { CollectionBoxDetail } from '../types';
import { formatName } from '../lib/format';
import { ViewToggle, type ViewMode } from '../components/table/ViewToggle';
import { CollectionTable } from '../components/CollectionTable';
import { usePersistentState } from '../lib/persistentState';
import { AddToBoxRail } from '../components/AddToBoxRail';

export function CollectionBoxPage() {
  const { boxId } = useParams();
  const navigate = useNavigate();
  const { refresh } = useCollection();
  const [box, setBox] = useState<CollectionBoxDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState('');
  // Card id only — the card view loads the rest itself.
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Shared across every collection rather than per box: the choice is about how you like to
  // read a list, not about this particular box.
  const [viewMode, setViewMode] = usePersistentState<ViewMode>('pokemans.collection.viewMode', 'tile');
  // Armed destination for the move rail. Null means tapping a card opens it, as usual.
  const [moveTargetId, setMoveTargetId] = useState<number | null>(null);
  const [moved, setMoved] = useState(0);
  const [undoMove, setUndoMove] = useState<{ entryId: number; fromBoxId: number; name: string } | null>(null);

  // Tapping a card moves it while a destination is armed, and opens it otherwise — the same
  // bargain the browse pages make when a collection is selected for filing.
  const handleCardTap = async (entryId: number, cardId: string, name: string) => {
    if (moveTargetId == null) {
      setLightbox(cardId);
      return;
    }
    // The row leaves the list straight away, so the card goes where it was sent without
    // waiting on a round trip; the re-read that follows only confirms it.
    setBox((b) => (b ? { ...b, entries: b.entries.filter((e) => e.id !== entryId) } : b));
    const res = await moveCollectionEntry(entryId, moveTargetId);
    setMoved((n) => n + 1);
    setUndoMove({ entryId, fromBoxId: res.movedFrom ?? Number(boxId), name });
    load(true);
    refresh();
  };

  const undoLastMove = async () => {
    if (!undoMove) return;
    await moveCollectionEntry(undoMove.entryId, undoMove.fromBoxId);
    setUndoMove(null);
    setMoved((n) => Math.max(0, n - 1));
    load(true);
    refresh();
  };

  /**
   * `silent` re-reads without raising the loading flag. The flag swaps the whole page for a
   * "Loading…" placeholder, which is right when arriving with nothing to show and wrong after
   * a move or a printing change: the page already holds a perfectly good render, and blanking
   * it to rebuild the identical thing a moment later reads as the interface flickering.
   */
  const load = (silent = false) => {
    if (!boxId) return;
    if (!silent) setLoading(true);
    fetchCollectionBox(Number(boxId))
      .then((data) => {
        setBox(data);
        setNameInput(data.name);
      })
      .catch((err) => console.error('Failed to load collection:', err))
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };

  useEffect(load, [boxId]);

  // Each row is one copy, so the box's value is simply the priced rows added up.
  const pricedTotal = box?.entries.reduce((sum, e) => sum + (e.price ?? 0), 0) ?? 0;
  const unpriced = box?.entries.filter((e) => e.price == null).length ?? 0;

  // Reloaded rather than patched in place: naming a printing changes what this copy is
  // worth, and the price comes from the server. `refresh` as well as `load`, because that
  // new price also changes what the box is worth on the collection list — the one mutation
  // here that used to update this page and leave that one showing the old total.
  const changeVariant = async (entryId: number, variantPosition: number | null) => {
    await setCollectionEntryVariant(entryId, variantPosition);
    load(true);
    refresh();
  };

  const removeEntry = async (entryId: number) => {
    if (!box) return;
    await removeCollectionEntry(entryId);
    setBox({ ...box, entries: box.entries.filter((e) => e.id !== entryId) });
    refresh();
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!box || !nameInput.trim() || nameInput.trim() === box.name) {
      setRenaming(false);
      return;
    }
    await renameCollectionBox(box.id, nameInput.trim());
    setBox({ ...box, name: nameInput.trim() });
    setRenaming(false);
    refresh();
  };

  const handleDelete = async () => {
    if (!box) return;
    if (!confirm(`Delete "${box.name}"? This removes all ${box.entries.length} card entries in it.`)) {
      return;
    }
    await deleteCollectionBox(box.id);
    refresh();
    navigate('/collection');
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 text-center text-[var(--color-text-muted)]">
        Loading…
      </div>
    );
  }

  if (!box) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 text-center">
        <p>Collection not found.</p>
        <Link to="/collection" className="text-[var(--color-accent)]">
          Back to My Collection
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Link
        to="/collection"
        className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        ← My Collection
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {renaming ? (
          <form onSubmit={handleRename} className="flex items-center gap-2">
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={handleRename}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-2xl font-bold outline-none focus:border-[var(--color-accent)]"
            />
          </form>
        ) : (
          <div className="flex items-center gap-2">
            {collectionColorHex(box.color) && (
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: collectionColorHex(box.color) ?? undefined }}
              />
            )}
            <h1
              onClick={() => setRenaming(true)}
              title="Click to rename"
              className="cursor-pointer text-2xl font-bold"
            >
              {box.name}
            </h1>
          </div>
        )}
        <button
          type="button"
          onClick={handleDelete}
          className="text-sm text-red-600 hover:underline dark:text-red-400"
        >
          Delete collection
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--color-text-muted)]">
          {box.entries.length} card{box.entries.length === 1 ? '' : 's'}
          {pricedTotal > 0 &&
            ` · ${new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(pricedTotal)}`}
          {unpriced > 0 && ` · ${unpriced} without a printing set`}
        </p>
        {box.entries.length > 0 && <ViewToggle mode={viewMode} onChange={setViewMode} />}
      </div>

      {box.entries.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-[var(--color-text-muted)]">
          This collection is empty. Add cards from any Pokémon's trading card gallery.
        </div>
      )}

      <div className="mt-6 flex flex-col gap-4 md:flex-row-reverse md:items-start">
        {box.entries.length > 0 && (
          <AddToBoxRail
            variant="move"
            excludeBoxId={box.id}
            activeBoxId={moveTargetId}
            onSelect={setMoveTargetId}
            mode="add"
            onModeChange={() => {}}
            actionCount={moved}
          />
        )}
        <div className="min-w-0 flex-1">
        {viewMode === 'table' ? (
          <div className="">
            <CollectionTable
              entries={box.entries}
              onOpenCard={(cardId) => {
                const e = box.entries.find((x) => x.cardId === cardId);
                if (e) handleCardTap(e.id, e.cardId, e.name);
              }}
              onChangeVariant={changeVariant}
              onRemove={removeEntry}
            />
          </div>
        ) : (
        <div className=" grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {box.entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
            >
              {/* The card face opens the card view, as it does everywhere else; the Pokémon
                  name below is still the way through to the Pokémon itself. */}
              {entry.imageSmall && (
                <button
                  type="button"
                  onClick={() => handleCardTap(entry.id, entry.cardId, entry.name)}
                  title={`View ${entry.name}`}
                  className="block w-full"
                >
                  <CardImage src={entry.imageSmall} alt={entry.name} className="w-full rounded" />
                </button>
              )}
              <p className="mt-1 truncate text-xs font-medium">{entry.name}</p>
              <p className="truncate text-xs text-[var(--color-text-muted)]">
                {entry.setName}
                {entry.number ? ` #${entry.number}` : ''}
              </p>
              {entry.pokemonName && (
                <Link
                  to={`/pokemon/${entry.pokemonId}`}
                  className="truncate text-xs capitalize text-[var(--color-accent)]"
                >
                  {formatName(entry.pokemonName)}
                </Link>
              )}

              {/* Which printing this copy is. Left unset by the quick-add flow, so it's
                  offered here rather than in the way of filing a card. */}
              {/* The card's own printings, so a card that was never printed in reverse holo
                  doesn't offer one. Vintage cards list each distinct print here — Unlimited,
                  Shadowless, Shadowless 1st Edition — which can differ hugely in value. */}
              {entry.printings.length > 0 && (
                <select
                  value={entry.variantPosition ?? ''}
                  onChange={(e) =>
                    changeVariant(entry.id, e.target.value === '' ? null : Number(e.target.value))
                  }
                  aria-label={`Printing of ${entry.name}`}
                  className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-xs text-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">Printing not set</option>
                  {entry.printings.map((p) => (
                    <option key={p.position} value={p.position}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}
              <div className="mt-2 text-sm font-semibold tabular-nums">
                {entry.price != null ? (
                  new Intl.NumberFormat(undefined, {
                    style: 'currency',
                    currency: entry.priceCurrency ?? 'USD',
                  }).format(entry.price)
                ) : (
                  <span
                    className="text-xs font-normal text-[var(--color-text-muted)]"
                    title="Set this copy's printing to price it"
                  >
                    Printing not set
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeEntry(entry.id)}
                className="mt-1 w-full rounded border border-[var(--color-border)] py-1 text-xs text-red-600 hover:border-red-400 dark:text-red-400"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        )}
        </div>
      </div>

      {undoMove && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm shadow-lg">
            <span>Moved {undoMove.name}</span>
            <button type="button" onClick={undoLastMove} className="font-semibold text-[var(--color-accent)]">
              Undo
            </button>
            <button
              type="button"
              onClick={() => setUndoMove(null)}
              aria-label="Dismiss"
              className="text-[var(--color-text-muted)]"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {lightbox && <CardLightbox cardId={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
