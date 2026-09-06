import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { Header } from './components/Header';
import { PokemonList } from './pages/PokemonList';
import { PokemonDetail } from './pages/PokemonDetail';
import { Settings } from './pages/Settings';
import { Collection } from './pages/Collection';
import { CollectionBoxPage } from './pages/CollectionBox';
import { SearchHelp } from './pages/SearchHelp';
import { ThemeProvider } from './lib/theme';
import { CollectionProvider } from './lib/collectionContext';
import { BrowseViewProvider } from './lib/browseView';

// history.scrollRestoration is set to 'manual' in main.tsx, which hands us full control
// of scroll position on every route change. Forward navigation (clicking a link) should
// always land at the top of the new page; Back/Forward landing on "/" is the one
// exception, left alone so PokemonBrowser/CardBrowser's own useScrollRestoration can
// restore exactly where the grid was scrolled to.
function ScrollManager() {
  const location = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    if (navType !== 'POP' || location.pathname !== '/') {
      window.scrollTo(0, 0);
    }
  }, [location.pathname, navType]);

  return null;
}

function App() {
  return (
    <ThemeProvider>
      <CollectionProvider>
        <BrowseViewProvider>
          <BrowserRouter>
            <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
              <Header />
              <ScrollManager />
              <Routes>
                <Route path="/" element={<PokemonList />} />
                <Route path="/pokemon/:id" element={<PokemonDetail />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/collection" element={<Collection />} />
                <Route path="/collection/:boxId" element={<CollectionBoxPage />} />
                <Route path="/search-help" element={<SearchHelp />} />
              </Routes>
            </div>
          </BrowserRouter>
        </BrowseViewProvider>
      </CollectionProvider>
    </ThemeProvider>
  );
}

export default App;
