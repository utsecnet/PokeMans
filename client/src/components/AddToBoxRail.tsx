import { useState } from 'react';
import { useCollection } from '../lib/collectionContext';
import { useWants } from '../lib/wantContext';
import { COLLECTION_COLORS, collectionColorHex } from '../lib/collectionColors';
import { useAnchoredPopover } from '../lib/useAnchoredPopover';
import { PortalPopoverPanel } from './PortalPopoverPanel';

export type RailMode = 'add' | 'remove';

/**
 * Which universe the rail is filing into. Collections hold copies you own; want lists hold
 * cards you don't.
 *
 * Deliberately a mode rather than one merged list of targets. A tap is a destructive-ish,
 * repeated action, and merging the two would make a mis-tap file a card you own into a
 * wishlist — or worse, in remove mode, delete a real copy when you meant to tick something
 * off a want list. Only one universe is ever selectable at a time.
 */
export type RailTarget = 'collection' | 'want';

const COLOR_POPOVER_WIDTH = 128;

function ColorDot({
  color,
  onPick,
  title,
}: {
  color: string | null;
  onPick: (color: string | null) => void;
  title: string;
}) {
  const { open, setOpen, triggerRef, popoverRef, coords } = useAnchoredPopover<HTMLButtonElement>(
    COLOR_POPOVER_WIDTH,
    140,
  );
  const hex = collectionColorHex(color);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title={title}
        className="h-4 w-4 shrink-0 rounded-full border border-[var(--color-border)]"
        style={{ backgroundColor: hex ?? 'transparent' }}
      />
      {open && coords && (
        <PortalPopoverPanel
          popoverRef={popoverRef}
          coords={coords}
          width={COLOR_POPOVER_WIDTH}
          className="grid grid-cols-5 gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg"
        >
          {COLLECTION_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              title={c.label}
              onClick={() => {
                onPick(c.key);
                setOpen(false);
              }}
              className={`h-5 w-5 rounded-full transition ${
                color === c.key ? 'ring-2 ring-offset-1 ring-[var(--color-text)] ring-offset-[var(--color-surface)]' : ''
              }`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
          <button
            type="button"
            title="No color"
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            className="col-span-5 mt-1 rounded border border-[var(--color-border)] py-0.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Clear
          </button>
        </PortalPopoverPanel>
      )}
    </>
  );
}

/** One selectable target — a collection or a want list; they render identically. */
function TargetRow({
  name,
  color,
  suffix,
  isActive,
  isRemove,
  onSelect,
  onColorChange,
  colorTitle,
}: {
  name: string;
  color: string | null;
  suffix?: string;
  isActive: boolean;
  isRemove: boolean;
  onSelect: () => void;
  onColorChange: (color: string | null) => void;
  colorTitle: string;
}) {
  const hex = collectionColorHex(color);
  // Remove mode always shows red regardless of the target's own color — that's a safety
  // signal ("this tap deletes"), which should never be silently overridden by decoration.
  const activeStyle =
    isActive && !isRemove && hex ? { borderColor: hex, backgroundColor: hex, color: '#fff' } : undefined;

  return (
    <div className="flex items-center gap-1.5">
      <ColorDot color={color} onPick={onColorChange} title={colorTitle} />
      <button
        type="button"
        onClick={onSelect}
        style={activeStyle}
        className={`flex min-w-0 flex-1 items-center justify-between gap-1 rounded-lg border px-2 py-1.5 text-left text-xs transition ${
          isActive
            ? isRemove
              ? 'border-red-500 bg-red-500 text-white'
              : hex
                ? ''
                : 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
        }`}
      >
        <span className="truncate">{name}</span>
        {suffix && <span className="shrink-0 opacity-70">{suffix}</span>}
      </button>
    </div>
  );
}

export function AddToBoxRail({
  activeBoxId,
  activeWantListId = null,
  onSelect,
  target = 'collection',
  onTargetChange,
  mode,
  onModeChange,
  actionCount,
  className = '',
  /**
   * 'move' is the box view's version: the source is already known, so there is no Add/Remove
   * choice to make and the collection this card is already in is not offered as a target.
   * Moving is collection-only, so that variant has no want tab either.
   */
  variant = 'file',
  excludeBoxId = null,
}: {
  activeBoxId: number | null;
  activeWantListId?: number | null;
  onSelect: (id: number | null) => void;
  target?: RailTarget;
  onTargetChange?: (target: RailTarget) => void;
  mode: RailMode;
  onModeChange: (mode: RailMode) => void;
  actionCount: number;
  className?: string;
  variant?: 'file' | 'move';
  excludeBoxId?: number | null;
}) {
  const { boxes: allBoxes, createBox, setBoxColor } = useCollection();
  const { lists: wantLists, createList, setListColor } = useWants();
  const isMove = variant === 'move';
  const isWant = !isMove && target === 'want';

  const boxes = excludeBoxId == null ? allBoxes : allBoxes.filter((b) => b.id !== excludeBoxId);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Under md the rail sits above the grid, where fully expanded it can push the cards off
  // the first screen entirely. Collapsed by default there, always open from md up.
  const [openOnMobile, setOpenOnMobile] = useState(false);

  const activeBox = allBoxes.find((b) => b.id === activeBoxId) ?? null;
  const activeList = wantLists.find((l) => l.id === activeWantListId) ?? null;
  const active = isWant
    ? activeList && { name: activeList.name, color: activeList.color }
    : activeBox && { name: activeBox.name, color: activeBox.color };
  const activeHex = collectionColorHex(active?.color ?? null);
  // Removing from a want list is just taking it off the list, so the red safety styling —
  // which means "this deletes a card you own" — is reserved for collections.
  const isRemove = mode === 'remove' && !isWant;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const created = isWant
        ? await createList(name, newColor)
        : await createBox(name, undefined, newColor);
      setNewName('');
      setNewColor(null);
      onSelect(created.id);
    } finally {
      setCreating(false);
    }
  };

  const verb = isWant
    ? mode === 'remove'
      ? 'remove it from'
      : 'add it to'
    : isMove
      ? 'move it to'
      : isRemove
        ? 'remove it from'
        : 'add it to';

  const summary = active
    ? `${isWant ? 'Want' : 'Collection'}: ${active.name}`
    : isMove
      ? 'Move to…'
      : 'Collections & wants';

  return (
    <aside
      className={`sticky top-20 z-10 w-full shrink-0 self-start rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm md:w-48 ${className}`}
    >
      {/* The whole rail folds into one line on a phone. Tapping a card is the thing you came
          to do, so the controls give the grid its space back until asked for. */}
      <button
        type="button"
        onClick={() => setOpenOnMobile((o) => !o)}
        aria-expanded={openOnMobile}
        className="flex w-full items-center justify-between gap-2 text-left font-semibold md:hidden"
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden="true" className="shrink-0 text-xs text-[var(--color-text-muted)]">
          {openOnMobile ? '▲' : '▼'}
        </span>
      </button>

      <div className={`${openOnMobile ? 'mt-3' : 'hidden'} md:mt-0 md:block`}>
        {isMove ? (
          <h3 className="font-semibold">Move to</h3>
        ) : (
          /* Collections and wants are different enough that the rail says which one you are
             in before it says anything else. */
          <div className="flex overflow-hidden rounded-lg border border-[var(--color-border)] text-xs">
            {(['collection', 'want'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTargetChange?.(t)}
                aria-pressed={target === t}
                className={`flex-1 py-1.5 font-medium transition ${
                  target === t
                    ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {t === 'collection' ? 'Collections' : 'Want'}
              </button>
            ))}
          </div>
        )}

        <div
          className={`mt-2 flex overflow-hidden rounded-full border border-[var(--color-border)] text-xs${isMove ? ' hidden' : ''}`}
        >
          <button
            type="button"
            onClick={() => onModeChange('add')}
            className={`flex-1 py-1 ${mode !== 'remove' ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]' : ''}`}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => onModeChange('remove')}
            className={`flex-1 py-1 ${
              mode === 'remove'
                ? isWant
                  ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
                  : 'bg-red-500 text-white'
                : ''
            }`}
          >
            Remove
          </button>
        </div>

        {active ? (
          <div
            className={`mt-2 rounded-lg p-2 text-xs ${isRemove ? 'bg-red-500/10' : activeHex ? '' : 'bg-[var(--color-accent)]/10'}`}
            style={!isRemove && activeHex ? { backgroundColor: `${activeHex}1a` } : undefined}
          >
            <p className="text-[var(--color-text-muted)]">Tap any card to {verb}</p>
            <p
              className={`truncate font-semibold ${isRemove ? 'text-red-600 dark:text-red-400' : activeHex ? '' : 'text-[var(--color-accent)]'}`}
              style={!isRemove && activeHex ? { color: activeHex } : undefined}
            >
              {active.name}
            </p>
            {actionCount > 0 && (
              <p className="mt-1 text-[var(--color-text-muted)]">
                {actionCount} {isMove ? 'moved' : mode === 'remove' ? 'removed' : 'added'} this visit
              </p>
            )}
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="mt-2 w-full rounded border border-[var(--color-border)] py-1 text-xs"
            >
              Stop
            </button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            Pick a {isWant ? 'want list' : 'collection'}, then tap cards below to{' '}
            {mode === 'remove' ? 'remove' : 'add'} them.
          </p>
        )}

        <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
          {isWant
            ? wantLists.map((list) => (
                <TargetRow
                  key={list.id}
                  name={list.name}
                  color={list.color}
                  suffix={`${list.ownedCount}/${list.wantedCount}`}
                  isActive={list.id === activeWantListId}
                  isRemove={false}
                  onSelect={() => onSelect(list.id === activeWantListId ? null : list.id)}
                  onColorChange={(color) => setListColor(list.id, color)}
                  colorTitle="Set want list color"
                />
              ))
            : boxes.map((box) => (
                <TargetRow
                  key={box.id}
                  name={box.name}
                  color={box.color}
                  isActive={box.id === activeBoxId}
                  isRemove={isRemove}
                  onSelect={() => onSelect(box.id === activeBoxId ? null : box.id)}
                  onColorChange={(color) => setBoxColor(box.id, color)}
                  colorTitle="Set collection color"
                />
              ))}
          {(isWant ? wantLists.length : boxes.length) === 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">
              No {isWant ? 'want lists' : 'collections'} yet.
            </p>
          )}
        </div>

        <form onSubmit={handleCreate} className="mt-3 flex flex-col gap-1 border-t border-[var(--color-border)] pt-2">
          {/* The colour sits on the left edge of the field it belongs to, rather than as a row
              of ten swatches beneath it. Same dot every existing collection already carries,
              so picking a colour is one gesture everywhere in the rail instead of two — and
              the rail is narrow enough that ten swatches cost a line of its height. */}
          <div className="flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 focus-within:border-[var(--color-accent)]">
            <ColorDot
              color={newColor}
              onPick={setNewColor}
              title={isWant ? 'Colour for the new want list' : 'Colour for the new collection'}
            />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={isWant ? 'New want list…' : 'New collection…'}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={!newName.trim() || creating}
            className="rounded bg-[var(--color-accent)] py-1 text-xs font-medium text-[var(--color-accent-contrast)] disabled:opacity-50"
          >
            Create &amp; select
          </button>
        </form>
      </div>
    </aside>
  );
}
