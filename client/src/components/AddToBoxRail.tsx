import { useState } from 'react';
import { useCollection } from '../lib/collectionContext';
import { COLLECTION_COLORS, collectionColorHex } from '../lib/collectionColors';
import { useAnchoredPopover } from '../lib/useAnchoredPopover';
import { PortalPopoverPanel } from './PortalPopoverPanel';
import type { CollectionBox } from '../types';

export type RailMode = 'add' | 'remove';

const COLOR_POPOVER_WIDTH = 128;

function ColorDot({
  color,
  onPick,
}: {
  color: string | null;
  onPick: (color: string | null) => void;
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
        title="Set collection color"
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

function BoxRow({
  box,
  isActive,
  isRemove,
  onSelect,
  onColorChange,
}: {
  box: CollectionBox;
  isActive: boolean;
  isRemove: boolean;
  onSelect: () => void;
  onColorChange: (color: string | null) => void;
}) {
  const hex = collectionColorHex(box.color);
  // Remove mode always shows red regardless of the box's own color — that's a safety
  // signal ("this tap deletes"), which should never be silently overridden by decoration.
  const activeStyle =
    isActive && !isRemove && hex ? { borderColor: hex, backgroundColor: hex, color: '#fff' } : undefined;

  return (
    <div className="flex items-center gap-1.5">
      <ColorDot color={box.color} onPick={onColorChange} />
      <button
        type="button"
        onClick={onSelect}
        style={activeStyle}
        className={`min-w-0 flex-1 truncate rounded-lg border px-2 py-1.5 text-left text-xs transition ${
          isActive
            ? isRemove
              ? 'border-red-500 bg-red-500 text-white'
              : hex
                ? ''
                : 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
        }`}
      >
        {box.name}
      </button>
    </div>
  );
}

export function AddToBoxRail({
  activeBoxId,
  onSelect,
  mode,
  onModeChange,
  actionCount,
  className = '',
}: {
  activeBoxId: number | null;
  onSelect: (boxId: number | null) => void;
  mode: RailMode;
  onModeChange: (mode: RailMode) => void;
  actionCount: number;
  className?: string;
}) {
  const { boxes, createBox, setBoxColor } = useCollection();
  const [newBoxName, setNewBoxName] = useState('');
  const [newBoxColor, setNewBoxColor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const activeBox = boxes.find((b) => b.id === activeBoxId) ?? null;
  const activeHex = collectionColorHex(activeBox?.color);
  const isRemove = mode === 'remove';

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newBoxName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const box = await createBox(name, undefined, newBoxColor);
      setNewBoxName('');
      setNewBoxColor(null);
      onSelect(box.id);
    } finally {
      setCreating(false);
    }
  };

  return (
    <aside
      className={`sticky top-20 z-10 w-full shrink-0 self-start rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm md:w-48 ${className}`}
    >
      <h3 className="font-semibold">Collections</h3>

      <div className="mt-2 flex overflow-hidden rounded-full border border-[var(--color-border)] text-xs">
        <button
          type="button"
          onClick={() => onModeChange('add')}
          className={`flex-1 py-1 ${!isRemove ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]' : ''}`}
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => onModeChange('remove')}
          className={`flex-1 py-1 ${isRemove ? 'bg-red-500 text-white' : ''}`}
        >
          Remove
        </button>
      </div>

      {activeBox ? (
        <div
          className={`mt-2 rounded-lg p-2 text-xs ${isRemove ? 'bg-red-500/10' : activeHex ? '' : 'bg-[var(--color-accent)]/10'}`}
          style={!isRemove && activeHex ? { backgroundColor: `${activeHex}1a` } : undefined}
        >
          <p className="text-[var(--color-text-muted)]">
            Tap any card to {isRemove ? 'remove it from' : 'add it to'}
          </p>
          <p
            className={`truncate font-semibold ${isRemove ? 'text-red-600 dark:text-red-400' : activeHex ? '' : 'text-[var(--color-accent)]'}`}
            style={!isRemove && activeHex ? { color: activeHex } : undefined}
          >
            {activeBox.name}
          </p>
          {actionCount > 0 && (
            <p className="mt-1 text-[var(--color-text-muted)]">
              {actionCount} {isRemove ? 'removed' : 'added'} this visit
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
          Pick a collection, then tap cards below to {isRemove ? 'remove' : 'add'} them.
        </p>
      )}

      <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
        {boxes.map((box) => (
          <BoxRow
            key={box.id}
            box={box}
            isActive={box.id === activeBoxId}
            isRemove={isRemove}
            onSelect={() => onSelect(box.id === activeBoxId ? null : box.id)}
            onColorChange={(color) => setBoxColor(box.id, color)}
          />
        ))}
        {boxes.length === 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">No collections yet.</p>
        )}
      </div>

      <form onSubmit={handleCreate} className="mt-3 flex flex-col gap-1 border-t border-[var(--color-border)] pt-2">
        <input
          type="text"
          value={newBoxName}
          onChange={(e) => setNewBoxName(e.target.value)}
          placeholder="New collection…"
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
        />
        <div className="flex flex-wrap gap-1">
          {COLLECTION_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              title={c.label}
              onClick={() => setNewBoxColor(newBoxColor === c.key ? null : c.key)}
              className={`h-4 w-4 rounded-full transition ${
                newBoxColor === c.key ? 'ring-2 ring-offset-1 ring-[var(--color-text)] ring-offset-[var(--color-surface)]' : ''
              }`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>
        <button
          type="submit"
          disabled={!newBoxName.trim() || creating}
          className="rounded bg-[var(--color-accent)] py-1 text-xs font-medium text-[var(--color-accent-contrast)] disabled:opacity-50"
        >
          Create &amp; select
        </button>
      </form>
    </aside>
  );
}
