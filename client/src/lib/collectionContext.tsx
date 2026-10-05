import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { SignInRequired } from './signInRequired';
import { useRequireAccount } from './requireAccount';
import {
  createCollectionBox,
  fetchCollectionBoxes,
  reorderCollectionBoxes,
  setCollectionBoxColor,
  setCollectionBoxIcon,
} from './api';
import type { CollectionBox, ContainerType } from '../types';

interface CollectionContextValue {
  boxes: CollectionBox[];
  lastUsedBoxId: number | null;
  /** When the daily price job last ran — null until it has. */
  pricesUpdatedAt: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  createBox: (name: string, type?: ContainerType, color?: string | null) => Promise<CollectionBox>;
  setBoxColor: (boxId: number, color: string | null) => Promise<void>;
  setBoxIcon: (boxId: number, icon: string | null) => Promise<void>;
  reorderBoxes: (ids: number[]) => Promise<void>;
  setLastUsedBoxId: (id: number) => void;
}

const CollectionContext = createContext<CollectionContextValue | null>(null);

export function CollectionProvider({ children }: { children: ReactNode }) {
  const [boxes, setBoxes] = useState<CollectionBox[]>([]);
  const [lastUsedBoxId, setLastUsedBoxIdState] = useState<number | null>(null);
  const [pricesUpdatedAt, setPricesUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await fetchCollectionBoxes();
    setBoxes(res.boxes);
    setLastUsedBoxIdState(res.lastUsedBoxId);
    setPricesUpdatedAt(res.pricesUpdatedAt ?? null);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const { requireAccount } = useRequireAccount();

  const createBox = useCallback(
    async (name: string, type: ContainerType = 'box', color: string | null = null) => {
      // The policies refuse this for a browsing session anyway; stopping here is what
      // turns a row-level-security error into an explanation.
      if (!requireAccount('Collections are kept with your account.')) {
        throw new SignInRequired();
      }
      const box = await createCollectionBox(name, type, color);
      setBoxes((prev) => [...prev, box]);
      setLastUsedBoxIdState(box.id);
      return box;
    },
    [requireAccount],
  );

  const setBoxColor = useCallback(async (boxId: number, color: string | null) => {
    await setCollectionBoxColor(boxId, color);
    setBoxes((prev) => prev.map((b) => (b.id === boxId ? { ...b, color } : b)));
  }, []);

  const setBoxIcon = useCallback(async (boxId: number, icon: string | null) => {
    await setCollectionBoxIcon(boxId, icon);
    setBoxes((prev) => prev.map((b) => (b.id === boxId ? { ...b, icon } : b)));
  }, []);

  /**
   * Applies the new order locally first, then persists it. Waiting for the round trip would
   * make a drag snap back before settling, which reads as the drag having failed.
   */
  const reorderBoxes = useCallback(async (ids: number[]) => {
    setBoxes((prev) => {
      const byId = new Map(prev.map((b) => [b.id, b]));
      const ordered = ids.map((id) => byId.get(id)).filter((b): b is CollectionBox => !!b);
      const rest = prev.filter((b) => !ids.includes(b.id));
      return [...ordered, ...rest].map((b, i) => ({ ...b, position: i }));
    });
    await reorderCollectionBoxes(ids);
  }, []);

  const setLastUsedBoxId = useCallback((id: number) => setLastUsedBoxIdState(id), []);

  // Memoised so consumers only re-render when the collection actually changes — a fresh
  // object literal here would invalidate every consumer on each provider render, including
  // the browsers' query schema (which is keyed off `boxes`) and with it their filter memo.
  const value = useMemo(
    () => ({
      boxes, lastUsedBoxId, pricesUpdatedAt, loading, refresh, createBox,
      setBoxColor, setBoxIcon, reorderBoxes, setLastUsedBoxId,
    }),
    [boxes, lastUsedBoxId, pricesUpdatedAt, loading, refresh, createBox, setBoxColor, setBoxIcon, reorderBoxes, setLastUsedBoxId],
  );

  return <CollectionContext.Provider value={value}>{children}</CollectionContext.Provider>;
}

export function useCollection(): CollectionContextValue {
  const ctx = useContext(CollectionContext);
  if (!ctx) throw new Error('useCollection must be used within CollectionProvider');
  return ctx;
}
