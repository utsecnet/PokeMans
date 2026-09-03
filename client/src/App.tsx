import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Header } from './components/Header';
import { PokemonList } from './pages/PokemonList';
import { PokemonDetail } from './pages/PokemonDetail';
import { Settings } from './pages/Settings';
import { ThemeProvider } from './lib/theme';

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
          <Header />
          <Routes>
            <Route path="/" element={<PokemonList />} />
            <Route path="/pokemon/:id" element={<PokemonDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
