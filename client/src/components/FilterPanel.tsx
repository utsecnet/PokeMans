import { useMemo, useState } from 'react';
import type { Expansion, MetaRanges, PokemonFilters, SortField, StatKey } from '../types';
import { cap, formatName } from '../lib/format';
import { DualRangeSlider } from './DualRangeSlider';
import { FilterSection } from './FilterSection';
import {
  CheckboxListSection,
  ExpansionFilterSection,
  FilterPanelShell,
  GenerationFilterSection,
  SortChainEditor,
  TypeFilterSection,
  toggleInList,
} from './filterParts';

const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP',
  attack: 'Attack',
  defense: 'Defense',
  specialAttack: 'Sp. Atk',
  specialDefense: 'Sp. Def',
  speed: 'Speed',
};

const SORT_FIELD_LABELS: Record<SortField, string> = {
  dex: 'Dex #',
  name: 'Name',
  hp: 'HP',
  attack: 'Attack',
  defense: 'Defense',
  specialAttack: 'Sp. Atk',
  specialDefense: 'Sp. Def',
  speed: 'Speed',
  height: 'Height',
  weight: 'Weight',
  baseExperience: 'Base XP',
  cardCount: 'Cards',
};

const ALL_SORT_FIELDS = Object.keys(SORT_FIELD_LABELS) as SortField[];

export const EMPTY_STATS: Record<StatKey, null> = {
  hp: null,
  attack: null,
  defense: null,
  specialAttack: null,
  specialDefense: null,
  speed: null,
};

export function defaultFilters(): PokemonFilters {
  return {
    search: '',
    types: [],
    typeMode: 'any',
    generations: [],
    abilities: [],
    expansions: [],
    stats: { ...EMPTY_STATS },
    height: null,
    weight: null,
    baseExperience: null,
    sortChain: [{ field: 'dex', dir: 'asc' }],
  };
}

function countActive(filters: PokemonFilters): number {
  let n = filters.types.length ? 1 : 0;
  n += filters.generations.length ? 1 : 0;
  n += filters.abilities.length ? 1 : 0;
  n += filters.expansions.length ? 1 : 0;
  n += Object.values(filters.stats).filter(Boolean).length;
  n += filters.height ? 1 : 0;
  n += filters.weight ? 1 : 0;
  n += filters.baseExperience ? 1 : 0;
  return n;
}

export function FilterPanel({
  filters,
  onChange,
  types,
  generations,
  abilities,
  expansions,
  ranges,
}: {
  filters: PokemonFilters;
  onChange: (next: PokemonFilters) => void;
  types: string[];
  generations: string[];
  abilities: string[];
  expansions: Expansion[];
  ranges: MetaRanges | null;
}) {
  const [abilityQuery, setAbilityQuery] = useState('');
  const activeCount = useMemo(() => countActive(filters), [filters]);
  const statsActiveCount = useMemo(
    () => Object.values(filters.stats).filter(Boolean).length,
    [filters.stats],
  );

  const filteredAbilities = useMemo(
    () => abilities.filter((a) => a.includes(abilityQuery.toLowerCase())),
    [abilities, abilityQuery],
  );

  const orderedExpansions = useMemo(() => expansions.slice().reverse(), [expansions]);

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

  return (
    <FilterPanelShell activeCount={activeCount} onReset={() => onChange(defaultFilters())}>
      <TypeFilterSection
        types={types}
        selected={filters.types}
        onToggle={(t) => onChange({ ...filters, types: toggleInList(filters.types, t) })}
        mode={filters.typeMode}
        onModeChange={(typeMode) => onChange({ ...filters, typeMode })}
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
        title="Abilities"
        values={filteredAbilities}
        selected={filters.abilities}
        onToggle={(a) => onChange({ ...filters, abilities: toggleInList(filters.abilities, a) })}
        label={formatName}
        capitalize
      >
        <input
          type="text"
          value={abilityQuery}
          onChange={(e) => setAbilityQuery(e.target.value)}
          placeholder="Search abilities…"
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </CheckboxListSection>

      <FilterSection title="Base Stats" badge={statsActiveCount}>
        <div className="space-y-4">
          {(Object.keys(STAT_LABELS) as StatKey[]).map((key) => {
            const bounds = statBounds(key);
            const value = filters.stats[key] ?? bounds;
            return (
              <div key={key}>
                <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
                  <span>{STAT_LABELS[key]}</span>
                  <span className="tabular-nums">
                    {value.min}–{value.max}
                  </span>
                </div>
                <div className="mt-1.5">
                  <DualRangeSlider
                    bounds={bounds}
                    value={value}
                    onChange={(v) => onChange({ ...filters, stats: { ...filters.stats, [key]: v } })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </FilterSection>

      <FilterSection title="Height (m)" badge={filters.height ? 1 : 0}>
        <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
          <span>
            {((filters.height?.min ?? heightBounds.min) / 10).toFixed(1)}–
            {((filters.height?.max ?? heightBounds.max) / 10).toFixed(1)} m
          </span>
        </div>
        <div className="mt-1.5">
          <DualRangeSlider
            bounds={heightBounds}
            value={filters.height ?? heightBounds}
            onChange={(v) => onChange({ ...filters, height: v })}
          />
        </div>
      </FilterSection>

      <FilterSection title="Weight (kg)" badge={filters.weight ? 1 : 0}>
        <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
          <span>
            {((filters.weight?.min ?? weightBounds.min) / 10).toFixed(1)}–
            {((filters.weight?.max ?? weightBounds.max) / 10).toFixed(1)} kg
          </span>
        </div>
        <div className="mt-1.5">
          <DualRangeSlider
            bounds={weightBounds}
            value={filters.weight ?? weightBounds}
            onChange={(v) => onChange({ ...filters, weight: v })}
          />
        </div>
      </FilterSection>

      <FilterSection title="Base Experience" badge={filters.baseExperience ? 1 : 0}>
        <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
          <span>
            {filters.baseExperience?.min ?? xpBounds.min}–{filters.baseExperience?.max ?? xpBounds.max}
          </span>
        </div>
        <div className="mt-1.5">
          <DualRangeSlider
            bounds={xpBounds}
            value={filters.baseExperience ?? xpBounds}
            onChange={(v) => onChange({ ...filters, baseExperience: v })}
          />
        </div>
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
