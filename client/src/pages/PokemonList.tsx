import { useBrowseView } from '../lib/browseView';
import { PokemonBrowser } from './PokemonBrowser';
import { CardBrowser } from './CardBrowser';

export function PokemonList() {
  const { view } = useBrowseView();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {view === 'pokemon' ? <PokemonBrowser /> : <CardBrowser />}
    </div>
  );
}
