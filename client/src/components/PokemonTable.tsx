import { Link, useNavigate } from 'react-router-dom';
import { CardImage } from './CardImage';
import type { MetaRanges, PokemonFilters, PokemonSummary, SortField, StatKey } from '../types';
import { cap, formatGeneration } from '../lib/format';
import { TypeBadge } from './TypeBadge';
import { FilterPopover } from './table/FilterPopover';
import { MultiSelectFilter } from './table/MultiSelectFilter';
import { RangeFilterContent } from './table/RangeFilterContent';

const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP',
  attack: 'Attack',
  defense: 'Defense',
  specialAttack: 'Sp. Atk',
  specialDefense: 'Sp. Def',
  speed: 'Speed',
};

export function PokemonTable({
  items,
  filters,
  onChange,
  searchValue,
  onSearchChange,
  visibleColumns,
  types,
  generations,
  ranges,
}: {
  items: PokemonSummary[];
  filters: PokemonFilters;
  onChange: (next: PokemonFilters) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  visibleColumns: string[];
  types: string[];
  generations: string[];
  ranges: MetaRanges | null;
}) {
  const navigate = useNavigate();
  const show = (key: string) => visibleColumns.includes(key);

  const statBounds = (key: StatKey) => {
    if (!ranges) return { min: 0, max: 255 };
    return {
      min: ranges[`min${cap(key)}` as keyof MetaRanges],
      max: ranges[`max${cap(key)}` as keyof MetaRanges],
    };
  };
  const heightBounds = ranges ? { min: ranges.minHeight, max: ranges.maxHeight } : { min: 0, max: 100 };
  const weightBounds = ranges ? { min: ranges.minWeight, max: ranges.maxWeight } : { min: 0, max: 10000 };
  const xpBounds = ranges
    ? { min: ranges.minBaseExperience, max: ranges.maxBaseExperience }
    : { min: 0, max: 700 };

  // Plain click sorts by only this column; shift+click adds/toggles it as an extra tie-
  // breaker in the chain, matching the card table and the sidebar's sort-rule list.
  const handleSort = (field: SortField, e: React.MouseEvent) => {
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
      onChange({
        ...filters,
        sortChain: [{ field, dir: filters.sortChain[0].dir === 'asc' ? 'desc' : 'asc' }],
      });
    } else {
      onChange({ ...filters, sortChain: [{ field, dir: 'asc' }] });
    }
  };

  const sortHeaderProps = (field: SortField) => ({
    onClick: (e: React.MouseEvent) => handleSort(field, e),
    title: 'Click to sort, Shift+click to add as secondary sort',
    className: 'cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left hover:text-[var(--color-accent)]',
  });

  const sortArrow = (field: SortField) => {
    const idx = filters.sortChain.findIndex((r) => r.field === field);
    if (idx === -1) return '';
    const dir = filters.sortChain[idx].dir === 'asc' ? '↑' : '↓';
    return filters.sortChain.length > 1 ? ` ${dir}${idx + 1}` : ` ${dir}`;
  };

  const statColumn = (key: StatKey) => {
    if (!show(key)) return null;
    const bounds = statBounds(key);
    const value = filters.stats[key] ?? bounds;
    return (
      <th key={key} {...sortHeaderProps(key)}>
        {STAT_LABELS[key]}
        {sortArrow(key)}
        <FilterPopover active={!!filters.stats[key]}>
          {() => (
            <RangeFilterContent
              bounds={bounds}
              value={value}
              onChange={(v) => onChange({ ...filters, stats: { ...filters.stats, [key]: v } })}
              onClear={() => onChange({ ...filters, stats: { ...filters.stats, [key]: null } })}
            />
          )}
        </FilterPopover>
      </th>
    );
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
      <table className="w-full min-w-max text-sm">
        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface)] text-xs uppercase text-[var(--color-text-muted)]">
          <tr>
            {show('sprite') && <th className="px-3 py-2 text-left">Image</th>}
            {show('dex') && <th {...sortHeaderProps('dex')}>Dex #{sortArrow('dex')}</th>}
            {show('name') && (
              <th {...sortHeaderProps('name')}>
                Name{sortArrow('name')}
                <FilterPopover active={!!searchValue}>
                  {() => (
                    <input
                      autoFocus
                      type="text"
                      value={searchValue}
                      onChange={(e) => onSearchChange(e.target.value)}
                      placeholder="Search name…"
                      className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
                    />
                  )}
                </FilterPopover>
              </th>
            )}
            {show('cardCount') && (
              <th {...sortHeaderProps('cardCount')}>Cards{sortArrow('cardCount')}</th>
            )}
            {show('types') && (
              <th className="whitespace-nowrap px-3 py-2 text-left">
                Type
                <FilterPopover active={filters.types.length > 0}>
                  {() => (
                    <div>
                      <div className="mb-2 flex overflow-hidden rounded-full border border-[var(--color-border)]">
                        <button
                          type="button"
                          onClick={() => onChange({ ...filters, typeMode: 'any' })}
                          className={`flex-1 py-0.5 ${filters.typeMode === 'any' ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]' : ''}`}
                        >
                          Any
                        </button>
                        <button
                          type="button"
                          onClick={() => onChange({ ...filters, typeMode: 'all' })}
                          className={`flex-1 py-0.5 ${filters.typeMode === 'all' ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]' : ''}`}
                        >
                          All
                        </button>
                      </div>
                      <MultiSelectFilter
                        options={types}
                        selected={filters.types}
                        onChange={(next) => onChange({ ...filters, types: next })}
                        renderLabel={(t) => <span className="capitalize">{t}</span>}
                      />
                    </div>
                  )}
                </FilterPopover>
              </th>
            )}
            {statColumn('hp')}
            {statColumn('attack')}
            {statColumn('defense')}
            {statColumn('specialAttack')}
            {statColumn('specialDefense')}
            {statColumn('speed')}
            {show('generation') && (
              <th className="whitespace-nowrap px-3 py-2 text-left">
                Generation
                <FilterPopover active={filters.generations.length > 0}>
                  {() => (
                    <MultiSelectFilter
                      options={generations}
                      selected={filters.generations}
                      onChange={(next) => onChange({ ...filters, generations: next })}
                      renderLabel={(g) => formatGeneration(g)}
                    />
                  )}
                </FilterPopover>
              </th>
            )}
            {show('height') && (
              <th {...sortHeaderProps('height')}>
                Height (m){sortArrow('height')}
                <FilterPopover active={!!filters.height}>
                  {() => (
                    <RangeFilterContent
                      bounds={heightBounds}
                      value={filters.height ?? heightBounds}
                      onChange={(v) => onChange({ ...filters, height: v })}
                      onClear={() => onChange({ ...filters, height: null })}
                      formatValue={(n) => (n / 10).toFixed(1)}
                    />
                  )}
                </FilterPopover>
              </th>
            )}
            {show('weight') && (
              <th {...sortHeaderProps('weight')}>
                Weight (kg){sortArrow('weight')}
                <FilterPopover active={!!filters.weight}>
                  {() => (
                    <RangeFilterContent
                      bounds={weightBounds}
                      value={filters.weight ?? weightBounds}
                      onChange={(v) => onChange({ ...filters, weight: v })}
                      onClear={() => onChange({ ...filters, weight: null })}
                      formatValue={(n) => (n / 10).toFixed(1)}
                    />
                  )}
                </FilterPopover>
              </th>
            )}
            {show('baseExperience') && (
              <th {...sortHeaderProps('baseExperience')}>
                Base XP{sortArrow('baseExperience')}
                <FilterPopover active={!!filters.baseExperience}>
                  {() => (
                    <RangeFilterContent
                      bounds={xpBounds}
                      value={filters.baseExperience ?? xpBounds}
                      onChange={(v) => onChange({ ...filters, baseExperience: v })}
                      onClear={() => onChange({ ...filters, baseExperience: null })}
                    />
                  )}
                </FilterPopover>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((p) => {
            // The sprite, not the artwork. This cell is 40x40, and the official artwork is a
            // 475px, 143 KB render — downloading that to paint a thumbnail is wasteful on any
            // platform and absurd on a phone. The 96px sprite is a tenth of a percent of the
            // size, ships with the app, and is the right resolution for the box it goes in.
            const image = p.spriteUrl ?? p.artworkUrl;
            return (
              <tr
                key={p.id}
                onClick={() => navigate(`/pokemon/${p.id}`)}
                className="cursor-pointer border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface)]"
              >
                {show('sprite') && (
                  <td className="px-3 py-1.5">
                    {image && <CardImage src={image} alt={p.name} loading="lazy" className="h-10 w-10 object-contain" />}
                  </td>
                )}
                {show('dex') && (
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)]">
                    #{String(p.nationalDexNumber).padStart(4, '0')}
                  </td>
                )}
                {show('name') && (
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <Link to={`/pokemon/${p.id}`} className="capitalize hover:text-[var(--color-accent)]">
                      {p.name.replace(/-/g, ' ')}
                    </Link>
                  </td>
                )}
                {show('cardCount') && (
                  <td className="px-3 py-1.5 tabular-nums text-[var(--color-text-muted)]">
                    {p.cardCount}
                  </td>
                )}
                {show('types') && (
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <div className="flex gap-1">
                      {p.types.map((t) => (
                        <TypeBadge key={t} type={t} />
                      ))}
                    </div>
                  </td>
                )}
                {show('hp') && <td className="px-3 py-1.5 tabular-nums">{p.hp ?? '—'}</td>}
                {show('attack') && <td className="px-3 py-1.5 tabular-nums">{p.attack ?? '—'}</td>}
                {show('defense') && <td className="px-3 py-1.5 tabular-nums">{p.defense ?? '—'}</td>}
                {show('specialAttack') && (
                  <td className="px-3 py-1.5 tabular-nums">{p.specialAttack ?? '—'}</td>
                )}
                {show('specialDefense') && (
                  <td className="px-3 py-1.5 tabular-nums">{p.specialDefense ?? '—'}</td>
                )}
                {show('speed') && <td className="px-3 py-1.5 tabular-nums">{p.speed ?? '—'}</td>}
                {show('generation') && (
                  <td className="whitespace-nowrap px-3 py-1.5 text-[var(--color-text-muted)]">
                    {p.generation ? formatGeneration(p.generation) : '—'}
                  </td>
                )}
                {show('height') && (
                  <td className="px-3 py-1.5 tabular-nums">{p.height != null ? p.height / 10 : '—'}</td>
                )}
                {show('weight') && (
                  <td className="px-3 py-1.5 tabular-nums">{p.weight != null ? p.weight / 10 : '—'}</td>
                )}
                {show('baseExperience') && (
                  <td className="px-3 py-1.5 tabular-nums">{p.baseExperience ?? '—'}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
