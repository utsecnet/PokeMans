export interface PokemonColumnDef {
  key: string;
  label: string;
  default: boolean;
}

// "Abilities" and "Expansions" filters have no per-row value on the Pokémon list
// endpoint (abilities aren't returned in the summary; expansions are a card-level
// concept), so they stay sidebar-only and aren't offered as table columns here.
export const POKEMON_COLUMNS: PokemonColumnDef[] = [
  { key: 'sprite', label: 'Image', default: true },
  { key: 'dex', label: 'Dex #', default: true },
  { key: 'name', label: 'Name', default: true },
  { key: 'cardCount', label: 'Cards', default: true },
  { key: 'types', label: 'Type', default: true },
  { key: 'hp', label: 'HP', default: true },
  { key: 'attack', label: 'Attack', default: true },
  { key: 'defense', label: 'Defense', default: true },
  { key: 'specialAttack', label: 'Sp. Atk', default: true },
  { key: 'specialDefense', label: 'Sp. Def', default: true },
  { key: 'speed', label: 'Speed', default: true },
  { key: 'generation', label: 'Generation', default: false },
  { key: 'height', label: 'Height', default: false },
  { key: 'weight', label: 'Weight', default: false },
  { key: 'baseExperience', label: 'Base XP', default: false },
];

export const DEFAULT_POKEMON_COLUMNS = POKEMON_COLUMNS.filter((c) => c.default).map((c) => c.key);
