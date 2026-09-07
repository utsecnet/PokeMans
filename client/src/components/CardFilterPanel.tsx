import { useMemo } from 'react';
import type { CardFilters, CardSortField, Expansion } from '../types';
import { FilterSection } from './FilterSection';
import { RarityIcon } from './RarityIcon';
import {
  CheckboxListSection,
  ExpansionFilterSection,
  FilterPanelShell,
  GenerationFilterSection,
  SortChainEditor,
  TypeFilterSection,
  toggleInList,
} from './filterParts';

const SORT_FIELD_LABELS: Record<CardSortField, string> = {
  releaseDate: 'Expansion (release date)',
  pokedexNumber: 'Pokédex number',
  pokemonName: 'Pokémon name',
  name: 'Card name',
  setName: 'Set name',
  number: 'Card number',
  rarity: 'Rarity',
};

const ALL_SORT_FIELDS = Object.keys(SORT_FIELD_LABELS) as CardSortField[];

export function defaultCardFilters(): CardFilters {
  return {
    search: '',
    expansions: [],
    series: [],
    rarities: [],
    types: [],
    generations: [],
    supertypes: [],
    illustrators: [],
    owned: null,
    sortChain: [{ field: 'releaseDate', dir: 'asc' }],
  };
}

function countActive(filters: CardFilters): number {
  let n = filters.expansions.length ? 1 : 0;
  n += filters.series.length ? 1 : 0;
  n += filters.rarities.length ? 1 : 0;
  n += filters.types.length ? 1 : 0;
  n += filters.generations.length ? 1 : 0;
  n += filters.supertypes.length ? 1 : 0;
  n += filters.illustrators.length ? 1 : 0;
  n += filters.owned !== null ? 1 : 0;
  return n;
}

export function CardFilterPanel({
  filters,
  onChange,
  expansions,
  series,
  rarities,
  types,
  generations,
  supertypes,
  illustrators,
}: {
  filters: CardFilters;
  onChange: (next: CardFilters) => void;
  expansions: Expansion[];
  series: string[];
  rarities: string[];
  types: string[];
  generations: string[];
  supertypes: string[];
  illustrators: string[];
}) {
  const activeCount = useMemo(() => countActive(filters), [filters]);
  const orderedExpansions = useMemo(() => expansions.slice().reverse(), [expansions]);
  const orderedSeries = useMemo(() => series.slice().reverse(), [series]);

  return (
    <FilterPanelShell activeCount={activeCount} onReset={() => onChange(defaultCardFilters())}>
      {/* Types, Generations and Expansions come first and in this order in both panels, so
          switching between Pokémon and cards doesn't move the controls around. */}
      <CheckboxListSection
        title="Card kind"
        values={supertypes}
        selected={filters.supertypes}
        onToggle={(v) => onChange({ ...filters, supertypes: toggleInList(filters.supertypes, v) })}
        emptyText="No card kinds synced yet."
      />

      <TypeFilterSection
        types={types}
        selected={filters.types}
        onToggle={(t) => onChange({ ...filters, types: toggleInList(filters.types, t) })}
      />

      <GenerationFilterSection
        generations={generations}
        selected={filters.generations}
        onToggle={(g) => onChange({ ...filters, generations: toggleInList(filters.generations, g) })}
      />

      <ExpansionFilterSection
        expansions={orderedExpansions}
        selected={filters.expansions}
        onToggle={(id) => onChange({ ...filters, expansions: toggleInList(filters.expansions, id) })}
      />

      <CheckboxListSection
        title="Series"
        values={orderedSeries}
        selected={filters.series}
        onToggle={(s) => onChange({ ...filters, series: toggleInList(filters.series, s) })}
        emptyText="No series synced yet."
      />

      <CheckboxListSection
        title="Rarity"
        values={rarities}
        selected={filters.rarities}
        onToggle={(r) => onChange({ ...filters, rarities: toggleInList(filters.rarities, r) })}
        icon={(r, on) => <RarityIcon rarity={r} active={on} />}
        emptyText="No rarities synced yet."
      />

      <CheckboxListSection
        title="Illustrator"
        values={illustrators}
        selected={filters.illustrators}
        onToggle={(v) => onChange({ ...filters, illustrators: toggleInList(filters.illustrators, v) })}
        emptyText="No illustrators synced yet — run a card sync."
      />

      <FilterSection title="My Collection" badge={filters.owned !== null ? 1 : 0}>
        <select
          value={filters.owned === null ? '' : String(filters.owned)}
          onChange={(e) =>
            onChange({
              ...filters,
              owned: e.target.value === '' ? null : e.target.value === 'true',
            })
          }
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm"
        >
          <option value="">Any</option>
          <option value="true">Owned</option>
          <option value="false">Not owned</option>
        </select>
      </FilterSection>

      <SortChainEditor
        chain={filters.sortChain}
        onChange={(sortChain) => onChange({ ...filters, sortChain })}
        labels={SORT_FIELD_LABELS}
        allFields={ALL_SORT_FIELDS}
      />
    </FilterPanelShell>
  );
}
