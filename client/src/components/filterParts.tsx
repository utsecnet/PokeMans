import type { CSSProperties, ReactNode } from 'react';
import type { Expansion } from '../types';
import { formatGeneration } from '../lib/format';
import { TypeIcon, typeKey } from './TypeIcon';
import { FilterSection } from './FilterSection';

// Every piece the Pokémon and card sidebars have in common lives here, so the two panels
// are the same controls rather than two versions of the same idea drifting apart. Each
// panel is then just an ordering of these plus whatever its own data supports (base stats
// and abilities for Pokémon; rarity, series and ownership for cards).

export function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function typePillStyle(type: string, selected: boolean): CSSProperties {
  // Shares typeKey with the icon so the chip's colour and its glyph can't disagree — they
  // did, which left card energies coloured correctly but wearing the fallback icon.
  const color = `var(--color-type-${typeKey(type)})`;
  return selected
    ? { backgroundColor: color, borderColor: color, color: 'white' }
    : { borderColor: color, color };
}

/** The panel frame: heading, count of active filters, and the reset control. */
export function FilterPanelShell({
  activeCount,
  onReset,
  children,
}: {
  activeCount: number;
  onReset: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          Filters
          {activeCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-xs font-semibold text-[var(--color-accent-contrast)]">
              {activeCount}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={onReset}
          disabled={activeCount === 0}
          className="text-xs text-[var(--color-text-muted)] underline decoration-dotted disabled:opacity-40"
        >
          Reset
        </button>
      </div>
      {children}
    </div>
  );
}

/**
 * Coloured type pills. `mode` is only supplied by the Pokémon panel, where a Pokémon can
 * hold two types at once and so "any of these" and "all of these" are different questions —
 * a card prints exactly one energy, which is why the card panel leaves it off.
 */
export function TypeFilterSection({
  types,
  selected,
  onToggle,
  mode,
  onModeChange,
}: {
  types: string[];
  selected: string[];
  onToggle: (type: string) => void;
  mode?: 'any' | 'all';
  onModeChange?: (mode: 'any' | 'all') => void;
}) {
  return (
    <FilterSection title="Types" badge={selected.length}>
      {mode && onModeChange && (
        <div className="mb-2 flex justify-end">
          <div className="flex overflow-hidden rounded-full border border-[var(--color-border)] text-xs">
            {(['any', 'all'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                className={`px-2 py-0.5 capitalize ${
                  mode === m ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]' : ''
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {types.map((t) => {
          const isOn = selected.includes(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => onToggle(t)}
              style={typePillStyle(t, isOn)}
              className="flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs font-medium capitalize transition"
            >
              <TypeIcon type={t} active={isOn} />
              {t}
            </button>
          );
        })}
      </div>
    </FilterSection>
  );
}

export function GenerationFilterSection({
  generations,
  selected,
  onToggle,
}: {
  generations: string[];
  selected: string[];
  onToggle: (generation: string) => void;
}) {
  return (
    <FilterSection title="Generations" badge={selected.length}>
      <div className="flex flex-wrap gap-1.5">
        {generations.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => onToggle(g)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
              selected.includes(g)
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
                : 'border-[var(--color-border)]'
            }`}
          >
            {formatGeneration(g)}
          </button>
        ))}
      </div>
    </FilterSection>
  );
}

export function ExpansionFilterSection({
  expansions,
  selected,
  onToggle,
}: {
  expansions: Expansion[];
  selected: string[];
  onToggle: (expansionId: string) => void;
}) {
  return (
    <FilterSection title="Expansions" badge={selected.length}>
      <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
        {expansions.map((exp) => (
          <label key={exp.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(exp.id)}
              onChange={() => onToggle(exp.id)}
              className="accent-[var(--color-accent)]"
            />
            {/* The set symbol, at text size. Sets synced before symbols were stored have
                none, so the row simply has no icon rather than a gap. */}
            {exp.symbolUrl && (
              <img
                src={exp.symbolUrl}
                alt=""
                loading="lazy"
                className="h-4 w-4 shrink-0 object-contain"
              />
            )}
            <span className="truncate">{exp.name}</span>
            {exp.series && (
              <span className="shrink-0 text-xs text-[var(--color-text-muted)]">{exp.series}</span>
            )}
          </label>
        ))}
        {expansions.length === 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">No expansions synced yet.</p>
        )}
      </div>
    </FilterSection>
  );
}

/** A scrolling checkbox list — series, rarities, abilities all share this shape. */
export function CheckboxListSection({
  title,
  values,
  selected,
  onToggle,
  label,
  emptyText = 'No matches.',
  capitalize = false,
  /** Optional glyph shown before each value — used by Rarity, left off elsewhere. */
  icon,
  children,
}: {
  title: string;
  values: string[];
  selected: string[];
  onToggle: (value: string) => void;
  label?: (value: string) => string;
  icon?: (value: string, selected: boolean) => ReactNode;
  emptyText?: string;
  capitalize?: boolean;
  children?: ReactNode;
}) {
  return (
    <FilterSection title={title} badge={selected.length}>
      {children}
      <div className={`max-h-36 space-y-1 overflow-y-auto pr-1${children ? ' mt-2' : ''}`}>
        {values.map((v) => (
          <label
            key={v}
            className={`flex cursor-pointer items-center gap-2 text-sm${capitalize ? ' capitalize' : ''}`}
          >
            <input
              type="checkbox"
              checked={selected.includes(v)}
              onChange={() => onToggle(v)}
              className="accent-[var(--color-accent)]"
            />
            {icon?.(v, selected.includes(v))}
            <span className="truncate">{label ? label(v) : v}</span>
          </label>
        ))}
        {values.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">{emptyText}</p>}
      </div>
    </FilterSection>
  );
}

export interface SortRule<F extends string> {
  field: F;
  dir: 'asc' | 'desc';
}

/**
 * The ordered sort-rule editor, used by both panels so sorting works the same way whichever
 * you're browsing: add rules, reorder them, and each one only breaks ties left by the one
 * above it.
 */
export function SortChainEditor<F extends string>({
  chain,
  onChange,
  labels,
  allFields,
}: {
  chain: SortRule<F>[];
  onChange: (chain: SortRule<F>[]) => void;
  labels: Record<F, string>;
  allFields: F[];
}) {
  const used = new Set(chain.map((r) => r.field));
  const available = allFields.filter((f) => !used.has(f));

  const updateRule = (index: number, patch: Partial<SortRule<F>>) =>
    onChange(chain.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const removeRule = (index: number) => {
    if (chain.length <= 1) return;
    onChange(chain.filter((_, i) => i !== index));
  };

  const moveRule = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= chain.length) return;
    const next = chain.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="border-t border-[var(--color-border)] pt-3">
      <h3 className="text-sm font-semibold">Sort by</h3>
      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
        Applied in order — each rule breaks ties left by the one above it.
      </p>
      <div className="mt-2 space-y-1.5">
        {chain.map((rule, i) => (
          <div key={rule.field} className="flex items-center gap-1">
            <span className="w-4 shrink-0 text-xs text-[var(--color-text-muted)]">{i + 1}.</span>
            <select
              value={rule.field}
              onChange={(e) => updateRule(i, { field: e.target.value as F })}
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs"
            >
              <option value={rule.field}>{labels[rule.field]}</option>
              {available.map((f) => (
                <option key={f} value={f}>
                  {labels[f]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => updateRule(i, { dir: rule.dir === 'asc' ? 'desc' : 'asc' })}
              title={rule.dir === 'asc' ? 'Ascending' : 'Descending'}
              className="shrink-0 rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs"
            >
              {rule.dir === 'asc' ? '↑' : '↓'}
            </button>
            <button
              type="button"
              onClick={() => moveRule(i, -1)}
              disabled={i === 0}
              title="Move up"
              className="shrink-0 rounded-lg border border-[var(--color-border)] px-1.5 py-1 text-xs disabled:opacity-30"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() => moveRule(i, 1)}
              disabled={i === chain.length - 1}
              title="Move down"
              className="shrink-0 rounded-lg border border-[var(--color-border)] px-1.5 py-1 text-xs disabled:opacity-30"
            >
              ▼
            </button>
            <button
              type="button"
              onClick={() => removeRule(i)}
              disabled={chain.length <= 1}
              title="Remove"
              className="shrink-0 rounded-lg border border-[var(--color-border)] px-1.5 py-1 text-xs text-red-600 disabled:opacity-30 dark:text-red-400"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {available.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([...chain, { field: available[0], dir: 'asc' }])}
          className="mt-2 w-full rounded-lg border border-dashed border-[var(--color-border)] py-1 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
        >
          + Add sort rule
        </button>
      )}
    </div>
  );
}
