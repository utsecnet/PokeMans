import { useCallback, useEffect, useRef, useState } from 'react';
import { CardImage } from '../components/CardImage';
import { Link, useParams } from 'react-router-dom';
import {
  addPrintingToWantList,
  fetchWantList,
  refreshWantList,
  removeWantEntry,
  setWantEntryVariant,
  updateWantList,
} from '../lib/api';
import { useWants } from '../lib/wantContext';
import { formatName } from '../lib/format';
import { collectionColorHex } from '../lib/collectionColors';
import { CardLightbox } from '../components/CardLightbox';
import { CardLocationBadge } from '../components/CardLocationBadge';
import { AddToBoxRail } from '../components/AddToBoxRail';
import { PencilIcon } from '../components/PencilIcon';
import { useBoxTapMode } from '../lib/boxTapMode';
import { usePersistentState } from '../lib/persistentState';
import { ViewToggle, type ViewMode } from '../components/table/ViewToggle';
import { WantTable } from '../components/WantTable';
import type { WantListDetail } from '../types';

type WantCard = WantListDetail['cards'][number];

export function WantListPage() {
  const { listId } = useParams<{ listId: string }>();
  const id = Number(listId);
  const { refresh: refreshLists } = useWants();
  const [list, setList] = useState<WantListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState('');
  // Its own key, not the collection's: a want list and a collection are read for
  // different reasons, and somebody who works through wants as rows may still want
  // their cards as faces.
  const [viewMode, setViewMode] = usePersistentState<ViewMode>('pokemans.wants.viewMode', 'tile');
  const {
    activeBoxId,
    setActiveBoxId,
    railMode,
    setRailMode,
    actionCount,
    handleTap,
    ringModeFor,
    target,
    setTarget,
    activeWantListId,
    activeBoxName,
  } = useBoxTapMode();

  // `silent` reloads without blanking the grid, so acquiring a card or toggling live
  // doesn't flash the whole page — the same pattern the collection box uses.
  // Which load is the current one, so a reply arriving after a newer request started is
  // dropped rather than overwriting it -- switching lists, or a silent refresh overlapping
  // the load it was meant to follow.
  //
  // A sequence number rather than the AbortController the detail pages use, because load()
  // is also called imperatively after every mutation, where there is no effect cleanup to
  // hang an abort on. One counter covers both callers.
  const loadSeq = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      const seq = ++loadSeq.current;
      if (!silent) setList(null);
      try {
        const data = await fetchWantList(id);
        if (seq !== loadSeq.current) return;
        setList(data);
        setError(null);
      } catch (err) {
        if (seq !== loadSeq.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load want list');
      }
    },
    [id],
  );

  useEffect(() => {
    load();
  }, [load]);

  /**
   * A tap files the card into the armed collection; with nothing armed it opens the card.
   *
   * The row is updated in place rather than refetched, so a card acquired here turns from
   * grey to full colour under the pointer and the "found" count above moves with it — the
   * whole point of filing from this page rather than from somewhere else.
   */
  const handleCardTap = (card: WantCard) =>
    handleTap(
      card,
      (inBoxes) => {
        // The tapped row only. Two rows of one card hold different printings, and what
        // counts as having it differs with them, so the others are reconciled by the
        // reload below rather than assumed to match.
        setList((prev) =>
          prev
            ? {
                ...prev,
                cards: prev.cards.map((c) =>
                  c.entryId === card.entryId ? { ...c, inBoxes } : c,
                ),
              }
            : prev,
        );
        // The index tile's progress is derived from collections, so it moves too.
        refreshLists();
        void load(true);
      },
      () => setOpenCardId(card.id),
    );

  const owned = list?.cards.filter((c) => c.inBoxes.length > 0).length ?? 0;
  const total = list?.cards.length ?? 0;
  const pct = total > 0 ? Math.round((owned / total) * 100) : 0;
  const hex = collectionColorHex(list?.color);

  const toggleLive = async () => {
    if (!list?.query) return;
    setBusy(true);
    try {
      await updateWantList(id, { live: !list.live });
      await load(true);
      refreshLists();
    } finally {
      setBusy(false);
    }
  };

  const runRefresh = async () => {
    setBusy(true);
    try {
      await refreshWantList(id);
      await load(true);
      refreshLists();
    } finally {
      setBusy(false);
    }
  };

  // One row, not the card: a list can want two printings of it, and the × is on the
  // tile for one of them.
  const removeEntry = async (entryId: number) => {
    await removeWantEntry(id, entryId);
    await load(true);
    refreshLists();
  };

  /**
   * The first printing of this card the list is not already waiting for, or null when
   * it is waiting for all of them.
   *
   * A card published in one printing has nothing to add: "any printing" and that one
   * printing are the same want said twice.
   */
  const freePrinting = (card: WantCard): number | null => {
    if (!list || card.printings.length < 2) return null;
    const taken = new Set(
      list.cards.filter((c) => c.id === card.id).map((c) => c.variantPosition),
    );
    return card.printings.find((p) => !taken.has(p.position))?.position ?? null;
  };

  /**
   * Wants another printing of a card already here.
   *
   * The page picks which one rather than asking first: the only sensible opening guess
   * is a printing this list is not already waiting for, and changing it is one click
   * away in the row that appears. The new row lands beside its sibling rather than at
   * the end of the list, which is the ordering want_list does.
   */
  const addPrinting = async (card: WantCard) => {
    const position = freePrinting(card);
    if (position === null) return;
    await addPrintingToWantList(id, card.id, position);
    await load(true);
    refreshLists();
  };

  /**
   * Issue #2. Reloads rather than patching the card in place: which collections count
   * as holding this card depends on the printing wanted, so the found-or-missing
   * state, the location badge and the progress bar all move together with it.
   */
  const changeVariant = async (entryId: number, variantPosition: number | null) => {
    await setWantEntryVariant(entryId, variantPosition);
    await load(true);
    refreshLists();
  };

  /**
   * The other half of issue #1. updateWantList has always taken a new name and the page
   * never offered one, so a want list kept whatever it was called when it was made.
   * Same inline form as a collection, so the two pages behave the same way.
   */
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = nameInput.trim();
    if (!list || !next || next === list.name) {
      setRenaming(false);
      return;
    }
    await updateWantList(id, { name: next });
    setList({ ...list, name: next });
    setRenaming(false);
    refreshLists();
  };

  if (error) {
    return <div className="mx-auto max-w-7xl px-4 py-6 text-red-600 dark:text-red-400">{error}</div>;
  }
  if (!list) {
    return <div className="mx-auto max-w-7xl px-4 py-6 text-[var(--color-text-muted)]">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Link to="/collection?tab=wants" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        ← Want lists
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {renaming ? (
            <form onSubmit={handleRename}>
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={handleRename}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-2xl font-bold outline-none focus:border-[var(--color-accent)]"
              />
            </form>
          ) : (
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              {hex && (
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: hex }}
                />
              )}
              <span
                onClick={() => {
                  setNameInput(list.name);
                  setRenaming(true);
                }}
                title="Click to rename"
                className="cursor-pointer truncate"
              >
                {list.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  setNameInput(list.name);
                  setRenaming(true);
                }}
                aria-label={`Rename ${list.name}`}
                title="Rename"
                className="shrink-0 text-[var(--color-text-muted)] transition hover:text-[var(--color-text)]"
              >
                <PencilIcon />
              </button>
            </h1>
          )}
          <p className="text-sm text-[var(--color-text-muted)]">
            {owned} of {total} found
            {list.query && (
              <>
                {' · '}
                {list.live ? 'following a filter' : 'snapshot of a filter'}
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {total > 0 && <ViewToggle mode={viewMode} onChange={setViewMode} />}

          {/* Only a list built from a filter can follow one, so the following controls are
              absent rather than disabled on a hand-built list — there is nothing for it to
              follow. */}
          {list.query && (
            <>
            {list.live && (
              <button
                type="button"
                onClick={runRefresh}
                disabled={busy}
                className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Check for new cards
              </button>
            )}
            <button
              type="button"
              onClick={toggleLive}
              disabled={busy}
              title={
                list.live
                  ? 'Stop absorbing newly matching cards; the list keeps what it has'
                  : 'Re-run the filter and keep absorbing cards that match it in future'
              }
              className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50 ${
                list.live
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
                  : 'border-[var(--color-border)]'
              }`}
            >
              {list.live ? 'Following filter' : 'Follow filter'}
            </button>
            </>
          )}
        </div>
      </div>

      {/* Progress, because the point of a want list is how much of it is left. */}
      {total > 0 && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${pct}%`, backgroundColor: hex ?? 'var(--color-accent)' }}
          />
        </div>
      )}

      {total === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-[var(--color-text-muted)]">
          Nothing on this list yet. Pick it in the rail on the Cards page, then tap cards to add
          them.
        </div>
      )}

      <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-start">
        <AddToBoxRail
          activeBoxId={activeBoxId}
          activeWantListId={activeWantListId}
          target={target}
          onTargetChange={setTarget}
          onSelect={setActiveBoxId}
          mode={railMode}
          onModeChange={setRailMode}
          actionCount={actionCount}
          className="md:order-2"
        />

        <div className="min-w-0 flex-1">
        {viewMode === 'table' ? (
          <WantTable
            cards={list.cards}
            onOpenCard={handleCardTap}
            onChangeVariant={changeVariant}
            onRemove={removeEntry}
            onAddPrinting={addPrinting}
            freePrinting={freePrinting}
          />
        ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4">
        {list.cards.map((card) => {
          const have = card.inBoxes.length > 0;
          return (
            <div
              key={card.entryId}
              className={`group relative rounded-lg border p-2 transition ${
                have
                  ? 'border-[var(--color-border)] bg-[var(--color-surface)]'
                  : 'border-dashed border-[var(--color-border)] bg-transparent'
              }`}
            >
              {card.imageSmall && (
                <button
                  type="button"
                  onClick={() => handleCardTap(card)}
                  title={
                    activeBoxId
                      ? railMode === 'remove'
                        ? `Remove from ${activeBoxName}`
                        : `Add to ${activeBoxName}`
                      : have
                        ? `View ${card.name}`
                        : `${card.name} — not in any collection`
                  }
                  className="block w-full"
                >
                  {/* Not yet found: drained of colour and mostly transparent, so the list
                      reads as a row of gaps with the found ones standing out. Saturation and
                      opacity together rather than either alone — opacity by itself still
                      leaves a recognisable colour cast on a busy holo card. */}
                  <CardImage
                    src={card.imageSmall}
                    alt={card.name}
                    loading="lazy"
                    className={`w-full rounded transition duration-300 ${
                      have
                        ? ''
                        : 'opacity-30 grayscale group-hover:opacity-60 group-hover:grayscale-[0.4]'
                    } ${
                      ringModeFor(card) === 'remove'
                        ? 'ring-2 ring-inset ring-red-500'
                        : ringModeFor(card) === 'add'
                          ? 'ring-2 ring-inset ring-[var(--color-accent)]'
                          : ''
                    }`}
                  />
                </button>
              )}
              <p className={`mt-1 truncate text-xs font-medium ${have ? '' : 'text-[var(--color-text-muted)]'}`}>
                {card.name}
              </p>
              <p className="truncate text-xs text-[var(--color-text-muted)]">
                {card.setName}
                {card.number ? ` #${card.number}` : ''}
              </p>
              {card.pokemonName && (
                <Link
                  to={`/pokemon/${card.pokemonId}`}
                  className={`truncate text-xs capitalize hover:underline ${
                    have ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'
                  }`}
                >
                  {formatName(card.pokemonName)}
                </Link>
              )}

              {/* The card's own printings, so one never printed in reverse holo does not
                  offer one. Only where there is a choice to make: a card published in a
                  single printing has nothing to narrow to, and the collection's copy of
                  this control shows it anyway because there it sets the price.

                  Any printing is the default and what every entry predating this held.
                  Naming one narrows the hunt, and a copy of a different printing stops
                  counting as having the card. */}
              {card.printings.length > 1 && (
                <select
                  value={card.variantPosition ?? ''}
                  onChange={(e) =>
                    changeVariant(
                      card.entryId,
                      e.target.value === '' ? null : Number(e.target.value),
                    )
                  }
                  aria-label={`Printing wanted of ${card.name}`}
                  className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-xs text-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">Any printing</option>
                  {card.printings.map((p) => (
                    <option key={p.position} value={p.position}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}

              {freePrinting(card) !== null && (
                <button
                  type="button"
                  onClick={() => addPrinting(card)}
                  title={`Want another printing of ${card.name} as well as this one`}
                  className="mt-1 w-full rounded border border-dashed border-[var(--color-border)] py-0.5 text-xs text-[var(--color-text-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                >
                  + another printing
                </button>
              )}

              {/* Where it actually is, for the ones already found. */}
              <CardLocationBadge inBoxes={card.inBoxes} />

              <button
                type="button"
                onClick={() => removeEntry(card.entryId)}
                title="Remove this want from the list"
                className="absolute right-1 top-1 rounded-full bg-[var(--color-surface)]/90 px-1.5 text-xs text-[var(--color-text-muted)] opacity-0 transition group-hover:opacity-100 hover:text-red-500"
              >
                ×
              </button>
            </div>
          );
        })}
        </div>
        )}
        </div>
      </div>

      {openCardId && <CardLightbox cardId={openCardId} onClose={() => setOpenCardId(null)} />}
    </div>
  );
}
