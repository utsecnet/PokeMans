import { useRef, useState } from 'react';
import { addToCollection, removeCollectionEntry, setCollectionEntryQuantity } from './api';
import { useCollection } from './collectionContext';
import type { CollectionBoxRef } from '../types';
import type { RailMode } from '../components/AddToBoxRail';

// Shared "tap a card to add/remove from an active box" behavior, used by both the
// standalone Cards browser and a Pokémon's card gallery so the two stay in sync.
export function useBoxTapMode() {
  const { boxes, refresh } = useCollection();
  const [activeBoxId, setActiveBoxIdState] = useState<number | null>(null);
  const [railMode, setRailModeState] = useState<RailMode>('add');
  const [actionCount, setActionCount] = useState(0);
  // Tapping the same card again before its first request resolves would race: both calls
  // compute `existing` from the same stale `card.inBoxes` snapshot, so whichever response
  // lands second overwrites the first's onUpdate — the server ends up with the right
  // quantity (each request independently bumps it), but the displayed count goes stale
  // until the next reload. Serialize taps per card instead of letting them race.
  const inFlightRef = useRef<Set<string>>(new Set());

  const setActiveBoxId = (id: number | null) => {
    setActiveBoxIdState(id);
    setActionCount(0);
  };

  const setRailMode = (mode: RailMode) => {
    setRailModeState(mode);
    setActionCount(0);
  };

  const reset = () => {
    setActiveBoxIdState(null);
    setRailModeState('add');
    setActionCount(0);
  };

  // With a box active, tapping a card face adds (or, in remove mode, removes) a copy
  // straight away instead of the caller's normal click behavior (e.g. opening a lightbox).
  const handleTap = async (
    card: { id: string; inBoxes: CollectionBoxRef[] },
    onUpdate: (inBoxes: CollectionBoxRef[]) => void,
    onFallback: () => void,
  ) => {
    if (!activeBoxId) {
      onFallback();
      return;
    }
    if (inFlightRef.current.has(card.id)) return; // a tap on this card is already in flight
    inFlightRef.current.add(card.id);

    try {
      if (railMode === 'remove') {
        const existing = card.inBoxes.find((b) => b.boxId === activeBoxId);
        if (!existing) return; // nothing to remove from this box
        const nextQty = existing.quantity - 1;
        if (nextQty <= 0) {
          await removeCollectionEntry(existing.entryId);
          onUpdate(card.inBoxes.filter((b) => b.boxId !== activeBoxId));
        } else {
          await setCollectionEntryQuantity(existing.entryId, nextQty);
          onUpdate(
            card.inBoxes.map((b) => (b.boxId === activeBoxId ? { ...b, quantity: nextQty } : b)),
          );
        }
        setActionCount((n) => n + 1);
        refresh();
        return;
      }

      const box = boxes.find((b) => b.id === activeBoxId);
      const result = await addToCollection(activeBoxId, card.id, 1);
      const existing = card.inBoxes.filter((b) => b.boxId !== activeBoxId);
      onUpdate([
        ...existing,
        { entryId: result.id, boxId: activeBoxId, boxName: box?.name ?? '', quantity: result.quantity },
      ]);
      setActionCount((n) => n + 1);
      refresh();
    } finally {
      inFlightRef.current.delete(card.id);
    }
  };

  const ringModeFor = (card: { inBoxes: CollectionBoxRef[] }): 'add' | 'remove' | null => {
    if (!activeBoxId) return null;
    if (!card.inBoxes.some((b) => b.boxId === activeBoxId)) return null;
    return railMode === 'remove' ? 'remove' : 'add';
  };

  const activeBoxName = boxes.find((b) => b.id === activeBoxId)?.name ?? 'box';

  return {
    activeBoxId,
    setActiveBoxId,
    railMode,
    setRailMode,
    actionCount,
    handleTap,
    ringModeFor,
    reset,
    activeBoxName,
  };
}
