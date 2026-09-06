import { Link } from 'react-router-dom';
import type { CardFilters, CardListItem, CardSortField, Expansion } from '../types';
import { formatName } from '../lib/format';
import { FilterPopover } from './table/FilterPopover';
import { MultiSelectFilter } from './table/MultiSelectFilter';
import { CardLocationBadge } from './CardLocationBadge';

export function CardTable({
  items,
  filters,
  onChange,
  searchValue,
  onSearchChange,
  visibleColumns,
  expansions,
  series,
  rarities,
  types,
  onCardClick,
  ringModeFor,
  activeMode,
  tapHint,
}: {
  items: CardListItem[];
  filters: CardFilters;
  onChange: (next: CardFilters) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  visibleColumns: string[];
  expansions: Expansion[];
  series: string[];
  rarities: string[];
  types: string[];
  onCardClick: (card: CardListItem) => void;
  ringModeFor: (card: CardListItem) => 'add' | 'remove' | null;
  activeMode: 'add' | 'remove' | null;
  tapHint?: string;
}) {
  const show = (key: string) => visibleColumns.includes(key);
  const expansionIds = expansions.map((e) => e.id);
  const expansionNameById = new Map(expansions.map((e) => [e.id, e.name]));

  // Plain click sorts by only this column; shift+click adds/toggles it as an extra tie-
  // breaker in the chain, mirroring the sidebar's ordered sort-rule list.
  const handleSort = (field: CardSortField, e: React.MouseEvent) => {
    const idx = filters.sortChain.findIndex((r) => r.field === field);
    if (e.shiftKey) {
      if (idx === -1) {
        onChange({ ...filters, sortChain: [...filters.sortChain, { field, dir: 'asc' }] });
      } else {
        const next = filters.sortChain.slice();
        next[idx] = { ...next[idx], dir: next[idx].dir === 'asc' ? 'desc' : 'asc' };
        onChange({ ...filters, sortChain: next });
      }
      return;
    }
    if (idx === 0 && filters.sortChain.length === 1) {
      onChange({ ...filters, sortChain: [{ field, dir: filters.sortChain[0].dir === 'asc' ? 'desc' : 'asc' }] });
    } else {
      onChange({ ...filters, sortChain: [{ field, dir: 'asc' }] });
    }
  };

  const sortIndicator = (field: CardSortField) => {
    const idx = filters.sortChain.findIndex((r) => r.field === field);
    if (idx === -1) return null;
    const dir = filters.sortChain[idx].dir === 'asc' ? '↑' : '↓';
    return filters.sortChain.length > 1 ? `${dir}${idx + 1}` : dir;
  };

  const sortableHeaderProps = (field: CardSortField) => ({
    onClick: (e: React.MouseEvent) => handleSort(field, e),
    title: 'Click to sort, Shift+click to add as secondary sort',
    className: 'cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left hover:text-[var(--color-accent)]',
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
      <table className="w-full min-w-max text-sm">
        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface)] text-xs uppercase text-[var(--color-text-muted)]">
          <tr>
            {show('name') && (
              <th {...sortableHeaderProps('name')}>
                Name {sortIndicator('name')}
                <FilterPopover active={!!searchValue}>
                  {() => (
                    <input
                      autoFocus
                      type="text"
                      value={searchValue}
                      onChange={(e) => onSearchChange(e.target.value)}
                      placeholder="Search cards or Pokémon…"
                      className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
                    />
                  )}
                </FilterPopover>
              </th>
            )}
            {show('pokemonName') && (
              <th {...sortableHeaderProps('pokemonName')}>Pokémon {sortIndicator('pokemonName')}</th>
            )}
            {show('setName') && (
              <th {...sortableHeaderProps('setName')}>
                Set {sortIndicator('setName')}
                <FilterPopover active={filters.expansions.length > 0}>
                  {() => (
                    <MultiSelectFilter
                      options={expansionIds}
                      selected={filters.expansions}
                      onChange={(next) => onChange({ ...filters, expansions: next })}
                      renderLabel={(id) => expansionNameById.get(id) ?? id}
                      searchable
                    />
                  )}
                </FilterPopover>
              </th>
            )}
            {show('number') && <th {...sortableHeaderProps('number')}>Number {sortIndicator('number')}</th>}
            {show('location') && <th className="whitespace-nowrap px-3 py-2 text-left">Location</th>}
            {show('rarity') && (
              <th {...sortableHeaderProps('rarity')}>
                Rarity {sortIndicator('rarity')}
                <FilterPopover active={filters.rarities.length > 0}>
                  {() => (
                    <MultiSelectFilter
                      options={rarities}
                      selected={filters.rarities}
                      onChange={(next) => onChange({ ...filters, rarities: next })}
                    />
                  )}
                </FilterPopover>
              </th>
            )}
            {show('series') && (
              <th className="whitespace-nowrap px-3 py-2 text-left">
                Series
                <FilterPopover active={filters.series.length > 0}>
                  {() => (
                    <MultiSelectFilter
                      options={series}
                      selected={filters.series}
                      onChange={(next) => onChange({ ...filters, series: next })}
                    />
                  )}
                </FilterPopover>
              </th>
            )}
            {show('releaseDate') && (
              <th {...sortableHeaderProps('releaseDate')}>Release Date {sortIndicator('releaseDate')}</th>
            )}
            {show('types') && (
              <th className="whitespace-nowrap px-3 py-2 text-left">
                Type
                <FilterPopover active={filters.types.length > 0}>
                  {() => (
                    <MultiSelectFilter
                      options={types}
                      selected={filters.types}
                      onChange={(next) => onChange({ ...filters, types: next })}
                      renderLabel={(t) => <span className="capitalize">{t}</span>}
                    />
                  )}
                </FilterPopover>
              </th>
            )}
            {show('owned') && (
              <th className="whitespace-nowrap px-3 py-2 text-left">
                Owned
                <FilterPopover active={filters.owned !== null}>
                  {() => (
                    <select
                      value={filters.owned === null ? '' : String(filters.owned)}
                      onChange={(e) =>
                        onChange({
                          ...filters,
                          owned: e.target.value === '' ? null : e.target.value === 'true',
                        })
                      }
                      className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs"
                    >
                      <option value="">Any</option>
                      <option value="true">Owned</option>
                      <option value="false">Not owned</option>
                    </select>
                  )}
                </FilterPopover>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((card) => {
            const ringMode = ringModeFor(card);
            return (
              <tr
                key={card.id}
                className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface)]"
              >
                {show('name') && (
                  <td className="whitespace-nowrap px-3 py-1">
                    <button type="button" onClick={() => onCardClick(card)} title={tapHint} className="text-left hover:text-[var(--color-accent)]">
                      {card.name}
                    </button>
                    {/* Carries what the thumbnail's ring used to: a plain glyph means "tap to
                        add", a filled badge means this card is already in the active box. */}
                    {activeMode && (
                      <span
                        title={ringMode ? 'Already in this box' : undefined}
                        className={`ml-1.5 rounded px-1 text-xs font-semibold ${
                          ringMode === 'remove'
                            ? 'bg-red-500 text-white'
                            : ringMode === 'add'
                              ? 'bg-[var(--color-accent)] text-white'
                              : activeMode === 'remove'
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-[var(--color-accent)]'
                        }`}
                      >
                        {activeMode === 'remove' ? '−' : '+'}
                      </span>
                    )}
                  </td>
                )}
                {show('pokemonName') && (
                  <td className="whitespace-nowrap px-3 py-1">
                    {card.pokemonId != null && card.pokemonName ? (
                      <Link to={`/pokemon/${card.pokemonId}`} className="capitalize text-[var(--color-accent)] hover:underline">
                        {formatName(card.pokemonName)}
                      </Link>
                    ) : (
                      // Trainer/Energy card — no Pokémon to link to.
                      <span className="text-[var(--color-text-muted)]">{card.supertype ?? '—'}</span>
                    )}
                  </td>
                )}
                {show('setName') && (
                  <td className="whitespace-nowrap px-3 py-1 text-[var(--color-text-muted)]">{card.setName ?? '—'}</td>
                )}
                {show('number') && <td className="px-3 py-1 tabular-nums">{card.number ?? '—'}</td>}
                {show('location') && (
                  <td className="px-3 py-1">
                    <CardLocationBadge inBoxes={card.inBoxes} />
                  </td>
                )}
                {show('rarity') && (
                  <td className="whitespace-nowrap px-3 py-1 text-[var(--color-text-muted)]">{card.rarity ?? '—'}</td>
                )}
                {show('series') && (
                  <td className="whitespace-nowrap px-3 py-1 text-[var(--color-text-muted)]">{card.series ?? '—'}</td>
                )}
                {show('releaseDate') && (
                  <td className="whitespace-nowrap px-3 py-1 text-[var(--color-text-muted)]">{card.releaseDate ?? '—'}</td>
                )}
                {show('types') && (
                  <td className="whitespace-nowrap px-3 py-1 capitalize text-[var(--color-text-muted)]">
                    {card.types.join(', ') || '—'}
                  </td>
                )}
                {show('owned') && (
                  <td className="px-3 py-1 tabular-nums">{card.totalOwned > 0 ? card.totalOwned : '—'}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
