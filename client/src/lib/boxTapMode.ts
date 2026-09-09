import { useRef, useState } from 'react';
import { addToCollection, addToWantList, removeCollectionEntry, removeFromWantList } from './api';
import { useCollection } from './collectionContext';
import { useWants } from './wantContext';
import type { CollectionBoxRef } from '../types';
import type { RailMode, RailTarget } from '../components/AddToBoxRail';

// Shared "tap a card to add/remove from an active target" behavior, used by both the
// standalone Cards browser and a Pokémon's card gallery so the two stay in sync.
//
// The target is either a collection or a want list. They keep separate active ids rather
// than one: switching tabs to glance at your want lists shouldn't silently disarm the
// collection you were filing into, and switching back should resume it.
export function useBoxTapMode() {
  const { boxes, refresh } = useCollection();
  const { lists, refresh: refreshWants } = useWants();
  const [target, setTargetState] = useState<RailTarget>('collection');
  const [activeBoxId, setActiveBoxIdState] = useState<number | null>(null);
  const [activeWantListId, setActiveWantListIdState] = useState<number | null>(null);
  const [railMode, setRailModeState] = useState<RailMode>('add');
  const [actionCount, setActionCount] = useState(0);
  // Tapping the same card again before its first request resolves would race: both calls
  // compute `existing` from the same stale `card.inBoxes` snapshot, so whichever response
  // lands second overwrites the first's onUpdate — the server ends up with the right
  // quantity (each request independently bumps it), but the displayed count goes stale
  // until the next reload. Serialize taps per card instead of letting them race.
  const inFlightRef = useRef<Set<string>>(new Set());

  const isWant = target === 'want';
  const activeId = isWant ? activeWantListId : activeBoxId;

  const setActiveId = (id: number | null) => {
    if (isWant) setActiveWantListIdState(id);
    else setActiveBoxIdState(id);
    setActionCount(0);
  };

  const setTarget = (next: RailTarget) => {
    setTargetState(next);
    setActionCount(0);
  };

  const setRailMode = (mode: RailMode) => {
    setRailModeState(mode);
    setActionCount(0);
  };

  const reset = () => {
    setActiveBoxIdState(null);
    setActiveWantListIdState(null);
    setTargetState('collection');
    setRailModeState('add');
    setActionCount(0);
  };

  // With a target active, tapping a card face files it straight away instead of the
  // caller's normal click behavior (e.g. opening a lightbox).
  const handleTap = async (
    card: { id: string; inBoxes: CollectionBoxRef[] },
    onUpdate: (inBoxes: CollectionBoxRef[]) => void,
    onFallback: () => void,
  ) => {
    if (!activeId) {
      onFallback();
      return;
    }
    if (inFlightRef.current.has(card.id)) return; // a tap on this card is already in flight
    inFlightRef.current.add(card.id);

    try {
      if (isWant) {
        // A want list holds cards, not copies, so nothing here touches inBoxes — what the
        // card grid shows about ownership is unchanged by wanting it.
        if (railMode === 'remove') await removeFromWantList(activeId, card.id);
        else await addToWantList(activeId, card.id);
        setActionCount((n) => n + 1);
        refreshWants();
        return;
      }

      if (railMode === 'remove') {
        const existing = card.inBoxes.find((b) => b.boxId === activeId);
        if (!existing) return; // nothing to remove from this box
        // Each copy is its own row, so removing one is a delete. entryId is the newest copy
        // in this box, which is the one to drop — an older copy is likelier to have had its
        // printing identified.
        await removeCollectionEntry(existing.entryId);
        const remaining = existing.quantity - 1;
        onUpdate(
          remaining <= 0
            ? card.inBoxes.filter((b) => b.boxId !== activeId)
            : card.inBoxes.map((b) => (b.boxId === activeId ? { ...b, quantity: remaining } : b)),
        );
        setActionCount((n) => n + 1);
        refresh();
        return;
      }

      const box = boxes.find((b) => b.id === activeId);
      const result = await addToCollection(activeId, card.id, 1);
      const existing = card.inBoxes.filter((b) => b.boxId !== activeId);
      onUpdate([
        ...existing,
        { entryId: result.id, boxId: activeId, boxName: box?.name ?? '', quantity: result.quantity },
      ]);
      setActionCount((n) => n + 1);
      refresh();
    } finally {
      inFlightRef.current.delete(card.id);
    }
  };

  // The ring drawn on a card that is already in the active target. Want lists have no
  // per-card state on the card object to read, so they get no ring — the want list page is
  // where membership is visible, and a ring here would need every list's contents loaded.
  const ringModeFor = (card: { inBoxes: CollectionBoxRef[] }): 'add' | 'remove' | null => {
    if (isWant || !activeBoxId) return null;
    if (!card.inBoxes.some((b) => b.boxId === activeBoxId)) return null;
    return railMode === 'remove' ? 'remove' : 'add';
  };

  const activeTargetName = isWant
    ? (lists.find((l) => l.id === activeWantListId)?.name ?? 'want list')
    : (boxes.find((b) => b.id === activeBoxId)?.name ?? 'box');

  return {
    target,
    setTarget,
    activeBoxId,
    activeWantListId,
    activeId,
    setActiveBoxId: setActiveId,
    railMode,
    setRailMode,
    actionCount,
    handleTap,
    ringModeFor,
    reset,
    activeBoxName: activeTargetName,
  };
}
