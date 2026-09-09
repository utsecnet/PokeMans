import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchCardIllustrators,
  fetchCardSupertypes,
  fetchCardTypes,
  fetchCards,
  fetchExpansions,
  fetchGenerations,
  fetchRarities,
  fetchSeries,
} from '../lib/api';
import type { CardFilters, CardListItem, Expansion } from '../types';
import { CardTile } from '../components/CardTile';
import { CardTable } from '../components/CardTable';
import { CardFilterPanel, defaultCardFilters } from '../components/CardFilterPanel';
import { AddToBoxRail } from '../components/AddToBoxRail';
import { MakeWantListButton } from '../components/MakeWantListButton';
import { Pagination } from '../components/Pagination';
import { ViewToggle, type ViewMode } from '../components/table/ViewToggle';
import { ColumnPicker } from '../components/table/ColumnPicker';
import { AdvancedSearchInput } from '../components/AdvancedSearchInput';
import { CardLightbox } from '../components/CardLightbox';
import { DEFAULT_CARD_COLUMNS, CARD_COLUMNS } from '../lib/cardTableColumns';
import { buildCardQuerySchema } from '../lib/cardQueryFields';
import { isAdvancedQuery, matchesQuery, parseQuery } from '../lib/queryLanguage';
import { usePersistentState } from '../lib/persistentState';
import { useScrollRestoration } from '../lib/scrollRestoration';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useBoxTapMode } from '../lib/boxTapMode';
import { useCollection } from '../lib/collectionContext';

const PAGE_SIZE = 60;
const BULK_PAGE_SIZE = 25000;

export function CardBrowser() {
  const [items, setItems] = useState<CardListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [bulkItems, setBulkItems] = useState<CardListItem[] | null>(null);
  const [page, setPage] = usePersistentState<number>('pokemans.cards.page', 1);
  const [filters, setFilters] = usePersistentState<CardFilters>(
    'pokemans.cards.filters',
    defaultCardFilters,
  );
  // Persisted separately from filters.search: advanced syntax is evaluated client-side and
  // must never reach the server's search param, so it is deliberately kept out of `filters`
  // — which also meant it was lost on reload. This keeps the box exactly as it was left.
  const [searchInput, setSearchInput] = usePersistentState<string>(
    'pokemans.cards.query',
    filters.search,
  );
  const [expansions, setExpansions] = useState<Expansion[]>([]);
  const [series, setSeries] = useState<string[]>([]);
  const [rarities, setRarities] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [supertypes, setSupertypes] = useState<string[]>([]);
  const [illustrators, setIllustrators] = useState<string[]>([]);
  const [generations, setGenerations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // Holds the whole card, not just its image URL: the lightbox doubles as the card's
  // detail view, showing print variants and live market prices.
  const [lightbox, setLightbox] = useState<CardListItem | null>(null);
  const skipNextPageReset = useRef(true);
  const [viewMode, setViewMode] = usePersistentState<ViewMode>('pokemans.cards.viewMode', 'tile');
  const [visibleColumns, setVisibleColumns] = usePersistentState<string[]>(
    'pokemans.cards.columns',
    DEFAULT_CARD_COLUMNS,
  );
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

  const { boxes } = useCollection();
  // Derived from the live input, not the debounced copy below: this gates whether the
  // search text is allowed to reach the server's `search` param at all, so it has to flip
  // the instant the query becomes advanced syntax.
  const advanced = isAdvancedQuery(searchInput);
  const querySchema = useMemo(
    () => buildCardQuerySchema(expansions, series, rarities, types, boxes.map((b) => b.name), illustrators),
    [expansions, series, rarities, types, boxes, illustrators],
  );
  // Filtering the bulk set walks every fetched row, so re-parsing on each keystroke would
  // put that whole pass between the key press and the character appearing. The plain-text
  // path is already debounced before it reaches the server; this is its counterpart for
  // the client-side path.
  const debouncedSearch = useDebouncedValue(searchInput, 200);
  const parsedQuery = useMemo(() => parseQuery(debouncedSearch), [debouncedSearch]);

  useEffect(() => {
    fetchExpansions().then(setExpansions).catch(() => {});
    fetchSeries().then(setSeries).catch(() => {});
    fetchRarities().then(setRarities).catch(() => {});
    // Card energy types, not Pokémon types — the two vocabularies differ.
    fetchCardTypes().then(setTypes).catch(() => {});
    fetchCardSupertypes().then(setSupertypes).catch(() => {});
    fetchCardIllustrators().then(setIllustrators).catch(() => {});
    fetchGenerations().then(setGenerations).catch(() => {});
  }, []);

  // Plain text stays on the fast server-side path; advanced syntax is evaluated
  // client-side instead, so it must never leak into the server's `search` param.
  useEffect(() => {
    if (advanced) return;
    const timeout = setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
    }, 250);
    return () => clearTimeout(timeout);
  }, [searchInput, advanced]);

  useEffect(() => {
    if (skipNextPageReset.current) {
      skipNextPageReset.current = false;
      return;
    }
    setPage(1);
  }, [filters, searchInput]);

  // Normal path: server-paginated, server-filtered. Clicking through pages faster than they
  // load used to let responses land out of order, leaving an earlier page's rows on screen
  // under a later page's number. `superseded` is what guarantees only the newest response
  // is applied; the abort is what stops the server still working on the ones we dropped.
  useEffect(() => {
    if (advanced) return;
    const controller = new AbortController();
    let superseded = false;
    setLoading(true);
    setBulkItems(null);
    fetchCards({ page, pageSize: PAGE_SIZE, filters, signal: controller.signal })
      .then((res) => {
        if (superseded) return;
        setItems(res.items);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((err) => {
        if (superseded) return;
        console.error('Failed to load cards:', err);
        setLoading(false);
      });
    return () => {
      superseded = true;
      controller.abort();
    };
  }, [page, filters, advanced]);

  // Advanced path: fetch everything matching the sidebar/table filters once, then filter
  // and (client-side, below) paginate the whole set locally.
  useEffect(() => {
    if (!advanced) return;
    const controller = new AbortController();
    let superseded = false;
    setLoading(true);
    fetchCards({
      page: 1,
      pageSize: BULK_PAGE_SIZE,
      filters: { ...filters, search: '' },
      signal: controller.signal,
    })
      .then((res) => {
        if (superseded) return;
        setBulkItems(res.items);
        setLoading(false);
      })
      .catch((err) => {
        if (superseded) return;
        console.error('Failed to load cards:', err);
        setLoading(false);
      });
    return () => {
      superseded = true;
      controller.abort();
    };
  }, [filters, advanced]);

  const advancedFiltered = useMemo(() => {
    if (!advanced || !bulkItems) return null;
    return bulkItems.filter((item) => matchesQuery(parsedQuery, item, querySchema));
  }, [advanced, bulkItems, parsedQuery, querySchema]);

  const displayItems =
    advanced && advancedFiltered
      ? advancedFiltered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
      : items;
  const displayTotal = advanced && advancedFiltered ? advancedFiltered.length : total;

  const updateCardCollection = (cardId: string, inBoxes: CardListItem['inBoxes']) => {
    const apply = (c: CardListItem) =>
      c.id === cardId ? { ...c, inBoxes, totalOwned: inBoxes.reduce((s, b) => s + b.quantity, 0) } : c;
    setItems((prev) => prev.map(apply));
    setBulkItems((prev) => (prev ? prev.map(apply) : prev));
  };

  useScrollRestoration('pokemans.cards.scrollY', !loading && displayItems.length > 0);

  const handleCardTap = (card: CardListItem) =>
    handleTap(
      card,
      (inBoxes) => updateCardCollection(card.id, inBoxes),
      () => setLightbox(card),
    );

  const totalPages = Math.max(1, Math.ceil(displayTotal / PAGE_SIZE));
  const isFiltered = useMemo(
    () =>
      searchInput.trim().length > 0 ||
      JSON.stringify(filters) !== JSON.stringify({ ...defaultCardFilters(), search: filters.search }),
    [searchInput, filters],
  );

  // Changing page while scrolled down otherwise drops you into the middle of the new page.
  // Scroll restoration only runs once per mount, so it doesn't fight this.
  const goToPage = (next: number) => {
    setPage(next);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      {viewMode === 'tile' && (
        <aside className="md:sticky md:top-20 md:w-72 md:shrink-0 md:max-h-[calc(100vh-5.5rem)] md:overflow-y-auto">
          <CardFilterPanel
            filters={filters}
            onChange={setFilters}
            expansions={expansions}
            series={series}
            rarities={rarities}
            types={types}
            generations={generations}
            supertypes={supertypes}
            illustrators={illustrators}
          />
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-4 md:flex-row md:items-start">
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
          <div className="mb-4 flex gap-2">
            <AdvancedSearchInput
              value={searchInput}
              onChange={setSearchInput}
              schema={querySchema}
              placeholder={'Search cards or Pokémon, or try rarity:"Double Rare" owned:false…'}
              helpHref="/search-help"
            />
            <ViewToggle mode={viewMode} onChange={setViewMode} />
            {viewMode === 'table' && (
              <ColumnPicker columns={CARD_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
            )}
          </div>

          {!loading && displayTotal === 0 && !isFiltered && (
            <div className="rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-[var(--color-text-muted)]">
              No cards in the database yet. Sync TCG cards in Settings to pull card data.
            </div>
          )}

          {!loading && displayTotal === 0 && isFiltered && (
            <div className="rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-[var(--color-text-muted)]">
              No cards match your search and filters.
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setFilters(defaultCardFilters());
                }}
                className="ml-1 text-[var(--color-accent)] underline"
              >
                Clear them
              </button>
              .
            </div>
          )}

          {displayTotal > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--color-text-muted)]">
              <p>
                {displayTotal} card{displayTotal === 1 ? '' : 's'}
                {isFiltered ? ' match' : ''}
              </p>
              {/* Offered only against a real filter: "make a want list of all 20,444 cards"
                  is never the intent, and the button would just be noise on an unfiltered
                  browse. Advanced queries the server can't push down are filtered in the
                  client, so the stored filter wouldn't reproduce them — those are excluded
                  rather than saved as something that means something different later. */}
              {isFiltered && !advanced && (
                <MakeWantListButton filters={filters} matchCount={displayTotal} />
              )}
            </div>
          )}

          {/* Repeated above the results as well as below them: with hundreds of pages, a
              page change from the bottom bar scrolls you to the top, and having to scroll
              back down to change it again is the whole complaint. */}
          <Pagination page={page} totalPages={totalPages} onChange={goToPage} compact position="top" />

          {/* Dim rather than blank while a page loads: the outgoing rows stay in place, so
              the grid doesn't collapse and reflow between pages. */}
          <div
            aria-busy={loading}
            className={loading ? 'opacity-50 transition-opacity duration-150' : 'transition-opacity duration-150'}
          >
            {viewMode === 'tile' ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {displayItems.map((card) => (
                  <CardTile
                    key={card.id}
                    card={card}
                    onImageClick={() => handleCardTap(card)}
                    ringMode={ringModeFor(card)}
                    activeMode={activeBoxId ? railMode : null}
                    tapHint={
                      activeBoxId
                        ? `${railMode === 'remove' ? 'Remove from' : 'Add to'} ${activeBoxName}`
                        : undefined
                    }
                  />
                ))}
              </div>
            ) : (
              <CardTable
                items={displayItems}
                filters={filters}
                onChange={setFilters}
                searchValue={searchInput}
                onSearchChange={setSearchInput}
                visibleColumns={visibleColumns}
                expansions={expansions}
                series={series}
                rarities={rarities}
                types={types}
                onCardClick={handleCardTap}
                ringModeFor={ringModeFor}
                activeMode={activeBoxId ? railMode : null}
                tapHint={
                  activeBoxId
                    ? `${railMode === 'remove' ? 'Remove from' : 'Add to'} ${activeBoxName}`
                    : undefined
                }
              />
            )}
          </div>

          <Pagination page={page} totalPages={totalPages} onChange={goToPage} compact />
        </div>
      </div>

      {lightbox && (
        <CardLightbox cardId={lightbox.id} card={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
