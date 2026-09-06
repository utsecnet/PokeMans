import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePersistentState } from './persistentState';

export type BrowseView = 'pokemon' | 'cards';

interface BrowseViewContextValue {
  view: BrowseView;
  setView: (view: BrowseView) => void;
}

const BrowseViewContext = createContext<BrowseViewContextValue | null>(null);

// Which of the two browsers the home page shows. It lives here rather than inside the page
// because the switch itself sits in the (sticky) header, above the route — so the control
// and the page it drives are rendered in different subtrees. Same storage key and format as
// before, so an existing saved preference carries over.
export function BrowseViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = usePersistentState<BrowseView>('pokemans.view', 'pokemon');
  const value = useMemo(() => ({ view, setView }), [view, setView]);
  return <BrowseViewContext.Provider value={value}>{children}</BrowseViewContext.Provider>;
}

export function useBrowseView(): BrowseViewContextValue {
  const ctx = useContext(BrowseViewContext);
  if (!ctx) throw new Error('useBrowseView must be used within BrowseViewProvider');
  return ctx;
}
