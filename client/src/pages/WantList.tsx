import { useCallback, useEffect, useState } from 'react';
import { CardImage } from '../components/CardImage';
import { Link, useParams } from 'react-router-dom';
import { fetchWantList, refreshWantList, removeFromWantList, updateWantList } from '../lib/api';
import { useWants } from '../lib/wantContext';
import { formatName } from '../lib/format';
import { collectionColorHex } from '../lib/collectionColors';
import { CardLightbox } from '../components/CardLightbox';
import { CardLocationBadge } from '../components/CardLocationBadge';
import { AddToBoxRail } from '../components/AddToBoxRail';
import { useBoxTapMode } from '../lib/boxTapMode';
import type { WantListDetail } from '../types';

export function WantListPage() {
  const { listId } = useParams<{ listId: string }>();
  const id = Number(listId);
  const { refresh: refreshLists } = useWants();
  const [list, setList] = useState<WantListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setList(null);
      try {
        setList(await fetchWantList(id));
        setError(null);
      } catch (err) {
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
  const handleCardTap = (card: WantListDetail['cards'][number]) =>
    handleTap(
      card,
      (inBoxes) => {
        setList((prev) =>
          prev
            ? { ...prev, cards: prev.cards.map((c) => (c.id === card.id ? { ...c, inBoxes } : c)) }
            : prev,
        );
        // The index tile's progress is derived from collections, so it moves too.
        refreshLists();
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

  const removeCard = async (cardId: string) => {
    await removeFromWantList(id, cardId);
    await load(true);
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
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {hex && (
              <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: hex }}
              />
            )}
            <span className="truncate">{list.name}</span>
          </h1>
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

        {/* Only a list built from a filter can follow one, so the control is absent rather
            than disabled on a hand-built list — there is nothing for it to follow. */}
        {list.query && (
          <div className="flex shrink-0 items-center gap-2">
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
          </div>
        )}
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

        <div className="grid min-w-0 flex-1 grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4">
        {list.cards.map((card) => {
          const have = card.inBoxes.length > 0;
          return (
            <div
              key={card.id}
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

              {/* Where it actually is, for the ones already found. */}
              <CardLocationBadge inBoxes={card.inBoxes} />

              <button
                type="button"
                onClick={() => removeCard(card.id)}
                title="Remove from this want list"
                className="absolute right-1 top-1 rounded-full bg-[var(--color-surface)]/90 px-1.5 text-xs text-[var(--color-text-muted)] opacity-0 transition group-hover:opacity-100 hover:text-red-500"
              >
                ×
              </button>
            </div>
          );
        })}
        </div>
      </div>

      {openCardId && <CardLightbox cardId={openCardId} onClose={() => setOpenCardId(null)} />}
    </div>
  );
}
