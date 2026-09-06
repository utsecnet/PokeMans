export interface CardColumnDef {
  key: string;
  label: string;
  default: boolean;
}

// Table view is the dense, text-only way to read the catalogue — card art belongs to grid
// view, where it's the point. Keeping thumbnails here cost a request per row and forced
// every row to the height of a card image.
export const CARD_COLUMNS: CardColumnDef[] = [
  { key: 'name', label: 'Name', default: true },
  { key: 'pokemonName', label: 'Pokémon', default: true },
  { key: 'setName', label: 'Set', default: true },
  { key: 'number', label: 'Number', default: true },
  { key: 'rarity', label: 'Rarity', default: true },
  { key: 'location', label: 'Location', default: true },
  { key: 'series', label: 'Series', default: false },
  { key: 'releaseDate', label: 'Release Date', default: false },
  { key: 'types', label: 'Type', default: false },
  { key: 'owned', label: 'Owned', default: false },
];

export const DEFAULT_CARD_COLUMNS = CARD_COLUMNS.filter((c) => c.default).map((c) => c.key);
