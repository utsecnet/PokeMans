import { useMemo } from 'react';
import { COLLECTION_COLORS, collectionColorHex } from '../lib/collectionColors';
import { COLLECTION_ICONS, type CollectionIconDef } from './collectionIcons';
import { CollectionIcon } from './CollectionIcon';

/**
 * Picks a collection's icon and colour together, because they are one appearance decision —
 * choosing a glyph and then hunting for the colour control elsewhere would make a two-step
 * job out of one. Colour sits above the icons, outside the scroll area, so it stays reachable
 * however far down the list you are and the swatches visibly follow it.
 *
 * Grouped and scrolled rather than filtered by a chip: with 57 icons the groups are what make
 * the list navigable, and hiding four of the five behind a filter means finding an icon
 * requires knowing which bucket it was put in first. The headings stick so that context
 * doesn't scroll away.
 */
export function CollectionIconPicker({
  icon,
  color,
  onPick,
  onClose,
}: {
  icon: string | null;
  color: string | null;
  onPick: (next: { icon?: string | null; color?: string | null }) => void;
  onClose: () => void;
}) {
  const hex = collectionColorHex(color);

  const groups = useMemo(() => {
    const byGroup = new Map<string, CollectionIconDef[]>();
    for (const def of COLLECTION_ICONS) {
      if (!byGroup.has(def.group)) byGroup.set(def.group, []);
      byGroup.get(def.group)!.push(def);
    }
    return [...byGroup.entries()];
  }, []);

  return (
    <div className="w-72 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <h4 className="text-xs font-semibold">Icon &amp; colour</h4>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          Done
        </button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] px-3 py-2">
        {COLLECTION_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            title={c.label}
            onClick={() => onPick({ color: color === c.key ? null : c.key })}
            className={`h-5 w-5 rounded-full transition ${
              color === c.key
                ? 'ring-2 ring-offset-1 ring-[var(--color-text)] ring-offset-[var(--color-surface)]'
                : ''
            }`}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>

      <div className="max-h-72 overflow-y-auto overscroll-contain px-3 pb-3">
        {groups.map(([group, icons]) => (
          <section key={group}>
            <h5 className="sticky top-0 z-10 -mx-3 bg-[var(--color-surface)] px-3 pb-1 pt-2 text-[11px] font-semibold text-[var(--color-text-muted)]">
              {group}
            </h5>
            <div className="grid grid-cols-6 gap-1.5">
              {icons.map((def) => {
                const active = (icon ?? 'pokeball') === def.id;
                return (
                  <button
                    key={def.id}
                    type="button"
                    title={def.label}
                    onClick={() => onPick({ icon: def.id })}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
                      active
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                        : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
                    }`}
                  >
                    {/* Heavier than the 1.1 these were approved at: scaled into a 22px box a
                        1.1 stroke lands under one device pixel and goes muddy, so the swatch
                        is drawn to match how the icon *looks* at full size rather than to
                        match its number. */}
                    <CollectionIcon icon={def.id} color={hex} className="h-[22px] w-[22px]" strokeWidth={1.5} />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
