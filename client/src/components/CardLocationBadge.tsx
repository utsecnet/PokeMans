import type { CollectionBoxRef } from '../types';
import { useCollection } from '../lib/collectionContext';
import { collectionColorHex } from '../lib/collectionColors';

const PIN_PATH =
  'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z';

// Always-visible (not tied to the floating rail's active-collection state) indicator of
// which collection(s) a card is already in — the core "know where a card is later" job
// this app exists for shouldn't require selecting each collection one at a time to check.
// One small pill per collection, tinted with that collection's own color when it has one.
export function CardLocationBadge({ inBoxes }: { inBoxes: CollectionBoxRef[] }) {
  const { boxes } = useCollection();
  if (inBoxes.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {inBoxes.map((ref) => {
        const hex = collectionColorHex(boxes.find((b) => b.id === ref.boxId)?.color);
        const style = hex
          ? { backgroundColor: `${hex}26`, color: hex }
          : undefined;
        return (
          <span
            key={ref.boxId}
            title={`${ref.boxName} (${ref.quantity})`}
            style={style}
            className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              hex ? '' : 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
            }`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-2.5 w-2.5 shrink-0">
              <path d={PIN_PATH} />
            </svg>
            <span className="truncate">
              {ref.boxName} ({ref.quantity})
            </span>
          </span>
        );
      })}
    </div>
  );
}
