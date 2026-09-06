import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchAbilities,
  fetchExpansions,
  fetchGenerations,
  fetchPokemonList,
  fetchRanges,
  fetchTypes,
} from '../lib/api';
import type { Expansion, MetaRanges, PokemonFilters, PokemonSummary } from '../types';
import { PokemonCard } from '../components/PokemonCard';
import { PokemonTable } from '../components/PokemonTable';
import { FilterPanel, defaultFilters } from '../components/FilterPanel';
import { Pagination } from '../components/Pagination';
import { ViewToggle, type ViewMode } from '../components/table/ViewToggle';
import { ColumnPicker } from '../components/table/ColumnPicker';
import { AdvancedSearchInput } from '../components/AdvancedSearchInput';
import { DEFAULT_POKEMON_COLUMNS, POKEMON_COLUMNS } from '../lib/pokemonTableColumns';
import { buildPokemonQuerySchema } from '../lib/pokemonQueryFields';
import { isAdvancedQuery, matchesQuery, parseQuery } from '../lib/queryLanguage';
import { usePersistentState } from '../lib/persistentState';
import { useScrollRestoration } from '../lib/scrollRestoration';
import { useDebouncedValue } from '../lib/useDebouncedValue';

const PAGE_SIZE = 60;
const BULK_PAGE_SIZE = 25000;

export function PokemonBrowser() {
  const [items, setItems] = useState<PokemonSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [bulkItems, setBulkItems] = useState<PokemonSummary[] | null>(null);
  const [page, setPage] = usePersistentState<number>('pokemans.pokemon.page', 1);
  // Key bumped when sortBy/sortDir became an ordered sortChain — a filter set stored under
  // the old shape has no chain for the panel to render, and these are transient view
  // settings, so starting from defaults is cleaner than migrating them.
  const [filters, setFilters] = usePersistentState<PokemonFilters>(
    'pokemans.pokemon.filters.v2',
    defaultFilters,
  );
  const [searchInput, setSearchInput] = useState(filters.search);
  const [types, setTypes] = useState<string[]>([]);
  const [generations, setGenerations] = useState<string[]>([]);
  const [abilities, setAbilities] = useState<string[]>([]);
  const [expansions, setExpansions] = useState<Expansion[]>([]);
  const [ranges, setRanges] = useState<MetaRanges | null>(null);
  const [loading, setLoading] = useState(true);
  const skipNextPageReset = useRef(true);
  const [viewMode, setViewMode] = usePersistentState<ViewMode>('pokemans.pokemon.viewMode', 'tile');
  // Key bumped when the Cards column was added: the stored list holds only the columns that
  // are visible, so a newly added column is indistinguishable from one deliberately hidden,
  // and would silently never appear for anyone with saved preferences.
  const [visibleColumns, setVisibleColumns] = usePersistentState<string[]>(
    'pokemans.pokemon.columns.v2',
    DEFAULT_POKEMON_COLUMNS,
  );

  // Derived from the live input, not the debounced copy below: this gates whether the
  // search text is allowed to reach the server's `search` param at all, so it has to flip
  // the instant the query becomes advanced syntax.
  const advanced = isAdvancedQuery(searchInput);
  const querySchema = useMemo(() => buildPokemonQuerySchema(types, generations), [types, generations]);
  // Filtering the bulk set walks every fetched row, so re-parsing on each keystroke would
  // put that whole pass between the key press and the character appearing. The plain-text
  // path is already debounced before it reaches the server; this is its counterpart for
  // the client-side path.
  const debouncedSearch = useDebouncedValue(searchInput, 200);
  const parsedQuery = useMemo(() => parseQuery(debouncedSearch), [debouncedSearch]);

  useEffect(() => {
    fetchTypes().then(setTypes).catch(() => {});
    fetchGenerations().then(setGenerations).catch(() => {});
    fetchAbilities().then(setAbilities).catch(() => {});
    fetchExpansions().then(setExpansions).catch(() => {});
    fetchRanges().then(setRanges).catch(() => {});
  }, []);

  // Plain text stays on the fast server-side path; the moment the query uses advanced
  // syntax, it's evaluated client-side instead, so it must never leak into the server's
  // `search` param.
  useEffect(() => {
    if (advanced) return;
    const timeout = setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
    }, 250);
    return () => clearTimeout(timeout);
  }, [searchInput, advanced]);

  useEffect(() => {
    // Skip the reset-to-page-1 that would otherwise fire on mount, from just hydrating
    // filters out of localStorage — that's not a user-initiated filter change, and would
    // silently defeat page persistence on every refresh.
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
    fetchPokemonList({ page, pageSize: PAGE_SIZE, filters, signal: controller.signal })
      .then((res) => {
        if (superseded) return;
        setItems(res.items);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((err) => {
        if (superseded) return;
        console.error('Failed to load Pokémon:', err);
        setLoading(false);
      });
    return () => {
      superseded = true;
      controller.abort();
    };
  }, [page, filters, advanced]);

  // Advanced path: fetch everything matching the sidebar/table filters once, then filter,
  // and (client-side, below) paginate the whole set locally — a query with AND/OR/NOT or
  // field operators can't be expressed as the server's simple `search` LIKE match.
  useEffect(() => {
    if (!advanced) return;
    const controller = new AbortController();
    let superseded = false;
    setLoading(true);
    fetchPokemonList({
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
        console.error('Failed to load Pokémon:', err);
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

  useScrollRestoration('pokemans.pokemon.scrollY', !loading && displayItems.length > 0);

  const totalPages = Math.max(1, Math.ceil(displayTotal / PAGE_SIZE));
  const isFiltered = useMemo(
    () =>
      searchInput.trim().length > 0 ||
      JSON.stringify(filters) !== JSON.stringify({ ...defaultFilters(), search: filters.search }),
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
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            types={types}
            generations={generations}
            abilities={abilities}
            expansions={expansions}
            ranges={ranges}
          />
        </aside>
      )}

      <div className="min-w-0 flex-1">
        <div className="mb-4 flex gap-2">
          <AdvancedSearchInput
            value={searchInput}
            onChange={setSearchInput}
            schema={querySchema}
            placeholder='Search Pokémon, or try an advanced query like type:fire hp>80…'
            helpHref="/search-help"
          />
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          {viewMode === 'table' && (
            <ColumnPicker columns={POKEMON_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
          )}
        </div>

        {!loading && displayTotal === 0 && !isFiltered && (
          <div className="rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-[var(--color-text-muted)]">
            No Pokémon in the database yet. Run <code className="font-mono">npm run sync</code>{' '}
            in the server to pull data from PokeAPI.
          </div>
        )}

        {!loading && displayTotal === 0 && isFiltered && (
          <div className="rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-[var(--color-text-muted)]">
            No Pokémon match your search and filters.
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setFilters(defaultFilters());
              }}
              className="ml-1 text-[var(--color-accent)] underline"
            >
              Clear them
            </button>
            .
          </div>
        )}

        {displayTotal > 0 && (
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">
            {displayTotal} Pokémon{isFiltered ? ' match' : ''}
          </p>
        )}

        {/* Dim rather than blank while a page loads: the outgoing rows stay in place, so
            the grid doesn't collapse and reflow between pages. */}
        <div
          aria-busy={loading}
          className={loading ? 'opacity-50 transition-opacity duration-150' : 'transition-opacity duration-150'}
        >
          {viewMode === 'tile' ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {displayItems.map((p) => (
                <PokemonCard key={p.id} pokemon={p} />
              ))}
            </div>
          ) : (
            <PokemonTable
              items={displayItems}
              filters={filters}
              onChange={setFilters}
              searchValue={searchInput}
              onSearchChange={setSearchInput}
              visibleColumns={visibleColumns}
              types={types}
              generations={generations}
              ranges={ranges}
            />
          )}
        </div>

        <Pagination page={page} totalPages={totalPages} onChange={goToPage} />
      </div>
    </div>
  );
}
