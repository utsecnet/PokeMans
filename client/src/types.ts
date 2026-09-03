export interface PokemonSummary {
  id: number;
  nationalDexNumber: number;
  name: string;
  generation: string | null;
  spriteUrl: string | null;
  artworkUrl: string | null;
  types: string[];
}

export interface PokemonListResponse {
  items: PokemonSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Ability {
  name: string;
  isHidden: boolean;
}

export interface Stats {
  hp: number;
  attack: number;
  defense: number;
  specialAttack: number;
  specialDefense: number;
  speed: number;
}

export interface EvolutionLink {
  id: number;
  name: string;
  spriteUrl: string | null;
  trigger: string | null;
  minLevel: number | null;
  item: string | null;
}

export interface TcgCard {
  id: string;
  name: string;
  setName: string | null;
  series: string | null;
  rarity: string | null;
  imageSmall: string | null;
  imageLarge: string | null;
}

export interface PokemonDetail {
  id: number;
  nationalDexNumber: number;
  name: string;
  generation: string | null;
  height: number | null;
  weight: number | null;
  baseExperience: number | null;
  flavorText: string | null;
  spriteUrl: string | null;
  artworkUrl: string | null;
  types: string[];
  abilities: Ability[];
  stats: Stats | null;
  evolvesFrom: EvolutionLink[];
  evolvesTo: EvolutionLink[];
  tcgCards: TcgCard[];
}

export interface SyncLogEntry {
  source: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'success' | 'error';
  recordsSynced: number;
  error: string | null;
}

export interface SyncStatus {
  active: { source: string; logId: number } | null;
  history: SyncLogEntry[];
}

export interface SettingsResponse {
  tcgApiKeySet: boolean;
}
