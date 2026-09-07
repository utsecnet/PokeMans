export interface PokemonSummary {
  id: number;
  nationalDexNumber: number;
  name: string;
  generation: string | null;
  spriteUrl: string | null;
  artworkUrl: string | null;
  types: string[];
  height: number | null;
  weight: number | null;
  baseExperience: number | null;
  hp: number | null;
  attack: number | null;
  defense: number | null;
  specialAttack: number | null;
  specialDefense: number | null;
  speed: number | null;
  /** How many TCG cards exist for this Pokémon, across every expansion. */
  cardCount: number;
}

export type SortField =
  | 'dex'
  | 'name'
  | 'hp'
  | 'attack'
  | 'defense'
  | 'specialAttack'
  | 'specialDefense'
  | 'speed'
  | 'height'
  | 'weight'
  | 'baseExperience'
  | 'cardCount';

export type SortDir = 'asc' | 'desc';

/** One rule in an ordered sort chain — the same shape the card browser uses. */
export interface PokemonSortRule {
  field: SortField;
  dir: SortDir;
}

export type StatKey = 'hp' | 'attack' | 'defense' | 'specialAttack' | 'specialDefense' | 'speed';

export interface StatRange {
  min: number;
  max: number;
}

export interface PokemonFilters {
  search: string;
  types: string[];
  typeMode: 'any' | 'all';
  generations: string[];
  abilities: string[];
  expansions: string[];
  stats: Record<StatKey, StatRange | null>;
  height: StatRange | null;
  weight: StatRange | null;
  baseExperience: StatRange | null;
  sortChain: PokemonSortRule[];
}

export interface MetaRanges {
  minHeight: number;
  maxHeight: number;
  minWeight: number;
  maxWeight: number;
  minBaseExperience: number;
  maxBaseExperience: number;
  minHp: number;
  maxHp: number;
  minAttack: number;
  maxAttack: number;
  minDefense: number;
  maxDefense: number;
  minSpecialAttack: number;
  maxSpecialAttack: number;
  minSpecialDefense: number;
  maxSpecialDefense: number;
  minSpeed: number;
  maxSpeed: number;
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

export interface EvolutionNode {
  id: number;
  name: string;
  spriteUrl: string | null;
  artworkUrl: string | null;
  types: string[];
  trigger: string | null;
  minLevel: number | null;
  item: string | null;
  children: EvolutionNode[];
}

export interface CollectionBoxRef {
  entryId: number;
  boxId: number;
  boxName: string;
  quantity: number;
}

export interface TcgCard {
  id: string;
  name: string;
  number: string | null;
  setId: string | null;
  setName: string | null;
  series: string | null;
  rarity: string | null;
  releaseDate: string | null;
  imageSmall: string | null;
  imageLarge: string | null;
  inBoxes: CollectionBoxRef[];
  totalOwned: number;
}

export interface CardListItem {
  id: string;
  name: string;
  number: string | null;
  setId: string | null;
  setName: string | null;
  series: string | null;
  rarity: string | null;
  releaseDate: string | null;
  imageSmall: string | null;
  imageLarge: string | null;
  /** "Pokémon", "Trainer" or "Energy" — the only thing identifying a non-Pokémon card. */
  supertype: string | null;
  illustrator: string | null;
  /** Every distinct printing of this card, in upstream order. */
  variants: CardPrinting[];
  // Null for Trainer and Energy cards, which have no Pokémon of their own.
  pokemonId: number | null;
  pokemonName: string | null;
  types: string[];
  inBoxes: CollectionBoxRef[];
  totalOwned: number;
}

export type CardSortField =
  | 'releaseDate'
  | 'name'
  | 'setName'
  | 'number'
  | 'rarity'
  | 'pokedexNumber'
  | 'pokemonName';

export interface CardSortRule {
  field: CardSortField;
  dir: SortDir;
}

export interface CardFilters {
  search: string;
  expansions: string[];
  series: string[];
  rarities: string[];
  types: string[];
  generations: string[];
  /** "Pokémon" | "Trainer" | "Energy" — what kind of card it is. */
  supertypes: string[];
  illustrators: string[];
  owned: boolean | null;
  sortChain: CardSortRule[];
}

export interface CardListResponse {
  items: CardListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * One distinct printing of a card. `type` is the finish (normal/reverse/holo); `subtype`
 * and `stamp` are what separate printings sharing a finish — Base Set Charizard's four holo
 * rows are Unlimited, Shadowless, Shadowless 1st Edition and the 1999-2000 copyright print.
 * `position` is its index in the card's variant list and is how a printing is referenced.
 */
export interface CardPrinting {
  position: number;
  type: string;
  subtype: string | null;
  stamp: string | null;
  /** Ready-to-show label, e.g. "Holo · Shadowless · 1st Edition". */
  label: string;
}

export interface CardPriceBucket {
  marketPrice?: number | null;
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
}

export interface CardVariantPricing {
  position: number;
  type: string;
  label: string;
  tcgplayer: (Record<string, CardPriceBucket> & { unit?: string; updated?: string }) | null;
  cardmarket: (Record<string, number | string> & { unit?: string }) | null;
}

export interface CardPricing {
  cardId: string;
  updated: string | null;
  variants: CardVariantPricing[];
  /**
   * False when the price rows couldn't be lined up with the stored printings, in which case
   * labels fall back to the bare finish rather than risk naming the wrong printing.
   */
  aligned?: boolean;
  unavailable?: string;
}

/** An external service the user can link with their own API key. */
export interface LinkedAccount {
  id: string;
  name: string;
  site: string;
  signupUrl: string;
  summary: string | null;
  keyLabel: string;
  keyPlaceholder: string;
  linked: boolean;
  /** Masked fragment of the stored key — the key itself is never returned. */
  keyHint: string | null;
  linkedAt: string | null;
  lastVerifiedAt: string | null;
}

export interface PricePoint {
  date: string;
  market: number;
  volume: number | null;
}

/** One recorded series: a printing, and a condition where the service reports one. */
export interface PriceSeries {
  label: string;
  /** The printing alone, so a printing's conditions can be folded into one band. */
  printingLabel: string;
  /** Which marketplace quoted it — the same printing priced by two is two series. */
  marketplace: string;
  variantPosition: number;
  condition: string | null;
  points: PricePoint[];
}

/** One chart per service; every value is converted to the display currency. */
export interface PriceChart {
  service: string;
  currency: string;
  series: PriceSeries[];
}

export interface CardPriceHistory {
  cardId: string;
  currency: string;
  /** True if some points were dropped because no exchange rate was available. */
  ratesUnavailable: boolean;
  charts: PriceChart[];
}

export type ContainerType = 'box' | 'deck' | 'collection';

export interface CollectionBox {
  id: number;
  name: string;
  type: ContainerType;
  color: string | null;
  createdAt: string;
  cardCount: number;
  totalQuantity: number;
  /** Value in USD from the latest daily snapshot; 0 for cards with no price captured yet. */
  valueUsd: number;
}

export interface CollectionBoxesResponse {
  boxes: CollectionBox[];
  lastUsedBoxId: number | null;
  /** When the daily price job last ran, or null if it hasn't yet. */
  pricesUpdatedAt: string | null;
}

export interface CollectionEntry {
  id: number;
  cardId: string;
  quantity: number;
  addedAt: string;
  name: string;
  number: string | null;
  setId: string | null;
  setName: string | null;
  series: string | null;
  rarity: string | null;
  imageSmall: string | null;
  imageLarge: string | null;
  pokemonId: number | null;
  pokemonName: string | null;
  /** Which printing this copy is (index into `printings`), or null when not recorded. */
  variantPosition: number | null;
  /** Label of the chosen printing, or null when not recorded. */
  variantLabel: string | null;
  /** The printings this card actually exists in, for choosing between. */
  printings: CardPrinting[];
}

export interface CollectionBoxDetail {
  id: number;
  name: string;
  type: ContainerType;
  color: string | null;
  createdAt: string;
  entries: CollectionEntry[];
}

export interface Expansion {
  id: string;
  name: string;
  series: string | null;
  releaseDate: string | null;
  /** The small set symbol printed on the card; null for sets synced before it was stored. */
  symbolUrl: string | null;
}

export interface PokemonVariant {
  id: number;
  name: string;
  variantLabel: string | null;
  spriteUrl: string | null;
  artworkUrl: string | null;
  types: string[];
  evolutionChain: EvolutionNode | null;
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
  isDefaultVariety: boolean;
  variantLabel: string | null;
  types: string[];
  abilities: Ability[];
  stats: Stats | null;
  variants: PokemonVariant[];
  evolutionChain: EvolutionNode | null;
  tcgCards: TcgCard[];
}

export interface SyncLogEntry {
  source: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'success' | 'error';
  recordsSynced: number;
  error: string | null;
  /** 'manual' if a button started it, 'auto' if the daily schedule did. */
  trigger: 'manual' | 'auto' | null;
}

export interface SourceCount {
  label: string;
  value: number;
}

export interface SourceState {
  id: 'pokeapi' | 'tcg' | 'prices';
  counts: SourceCount[];
  lastRun: {
    startedAt: string;
    status: string;
    recordsSynced: number;
    trigger: string | null;
  } | null;
}

export interface SyncStatus {
  active: { source: string; logId: number } | null;
  history: SyncLogEntry[];
}
