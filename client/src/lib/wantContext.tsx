import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRequireAccount } from './requireAccount';
import { SignInRequired } from './signInRequired';
import { createWantList, fetchWantLists, updateWantList } from './api';
import type { WantList } from '../types';

/**
 * Want lists, kept in their own provider rather than folded into collectionContext.
 *
 * They are a separate thing that happens to look similar: a collection holds copies you
 * own, priced and counted, and a want list holds cards you don't. Sharing a provider would
 * mean every want-list edit invalidated the collection context too — and that context feeds
 * the browsers' query schema, so a tap on a want list would re-derive every card filter.
 */
interface WantContextValue {
  lists: WantList[];
  loading: boolean;
  refresh: () => Promise<void>;
  createList: (
    name: string,
    color?: string | null,
    query?: string | null,
    live?: boolean,
  ) => Promise<WantList>;
  setListColor: (listId: number, color: string | null) => Promise<void>;
  setListLive: (listId: number, live: boolean) => Promise<number>;
}

const WantContext = createContext<WantContextValue | null>(null);

export function WantProvider({ children }: { children: ReactNode }) {
  const [lists, setLists] = useState<WantList[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await fetchWantLists();
    setLists(res.lists);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const { requireAccount } = useRequireAccount();

  const createList = useCallback(
    async (name: string, color: string | null = null, query: string | null = null, live = false) => {
      if (!requireAccount('Want lists are kept with your account.')) {
        throw new SignInRequired();
      }
      const list = await createWantList(name, color, query, live);
      setLists((prev) => [...prev, list].sort((a, b) => a.name.localeCompare(b.name)));
      return list;
    },
    [requireAccount],
  );

  const setListColor = useCallback(async (listId: number, color: string | null) => {
    await updateWantList(listId, { color });
    setLists((prev) => prev.map((l) => (l.id === listId ? { ...l, color } : l)));
  }, []);

  /**
   * Returns how many cards the switch pulled in, so the caller can say so — turning a
   * snapshot into a live list can add a lot at once, and silently growing someone's list
   * by 200 cards is worse than telling them it happened.
   */
  const setListLive = useCallback(async (listId: number, live: boolean) => {
    const updated = await updateWantList(listId, { live });
    setLists((prev) =>
      prev.map((l) =>
        l.id === listId
          ? { ...l, live, wantedCount: updated.wantedCount ?? l.wantedCount, lastSyncedAt: updated.lastSyncedAt }
          : l,
      ),
    );
    return updated.added ?? 0;
  }, []);

  const value = useMemo(
    () => ({ lists, loading, refresh, createList, setListColor, setListLive }),
    [lists, loading, refresh, createList, setListColor, setListLive],
  );

  return <WantContext.Provider value={value}>{children}</WantContext.Provider>;
}

export function useWants(): WantContextValue {
  const ctx = useContext(WantContext);
  if (!ctx) throw new Error('useWants must be used within WantProvider');
  return ctx;
}
