// Shared test data for the advanced-search test suites (regression, fuzz, integration,
// perf). Kept separate from the suites themselves so every file exercises the exact same
// schema/dataset shapes the real app builds via buildPokemonQuerySchema/buildCardQuerySchema.
import type { QuerySchema } from '../queryLanguage.ts';
import { buildPokemonQuerySchema } from '../pokemonQueryFields.ts';
import { buildCardQuerySchema } from '../cardQueryFields.ts';
import type { CardListItem, PokemonSummary } from '../../types.ts';

export const MON_TYPES = ['fire', 'water', 'grass', 'electric', 'flying', 'poison'];
export const MON_GENERATIONS = ['generation-i', 'generation-ii'];

export const pokemonSchema: QuerySchema<PokemonSummary> = buildPokemonQuerySchema(
  MON_TYPES,
  MON_GENERATIONS,
);

function mon(overrides: Partial<PokemonSummary>): PokemonSummary {
  return {
    id: 0,
    nationalDexNumber: 0,
    name: 'missingno',
    generation: 'generation-i',
    spriteUrl: null,
    artworkUrl: null,
    types: [],
    height: 10,
    weight: 100,
    baseExperience: 60,
    hp: 50,
    attack: 50,
    defense: 50,
    specialAttack: 50,
    specialDefense: 50,
    speed: 50,
    cardCount: 0,
    ...overrides,
  };
}

// A small, hand-picked roster covering: multi-type, single-type, stat extremes, and both
// synced generations — enough to exercise every field/operator without a huge fixture.
export const POKEMON_FIXTURE: PokemonSummary[] = [
  mon({
    id: 6,
    nationalDexNumber: 6,
    name: 'charizard',
    generation: 'generation-i',
    types: ['fire', 'flying'],
    hp: 78,
    attack: 84,
    defense: 78,
    specialAttack: 109,
    specialDefense: 85,
    speed: 100,
    height: 17,
    weight: 905,
    baseExperience: 267,
  }),
  mon({
    id: 4,
    nationalDexNumber: 4,
    name: 'charmander',
    generation: 'generation-i',
    types: ['fire'],
    hp: 39,
    attack: 52,
    defense: 43,
    specialAttack: 60,
    specialDefense: 50,
    speed: 65,
    height: 6,
    weight: 85,
    baseExperience: 62,
  }),
  mon({
    id: 9,
    nationalDexNumber: 9,
    name: 'blastoise',
    generation: 'generation-i',
    types: ['water'],
    hp: 79,
    attack: 83,
    defense: 100,
    specialAttack: 85,
    specialDefense: 105,
    speed: 78,
    height: 16,
    weight: 855,
    baseExperience: 265,
  }),
  mon({
    id: 3,
    nationalDexNumber: 3,
    name: 'venusaur',
    generation: 'generation-i',
    types: ['grass', 'poison'],
    hp: 80,
    attack: 82,
    defense: 83,
    specialAttack: 100,
    specialDefense: 100,
    speed: 80,
    height: 20,
    weight: 1000,
    baseExperience: 263,
  }),
  mon({
    id: 25,
    nationalDexNumber: 25,
    name: 'pikachu',
    generation: 'generation-i',
    types: ['electric'],
    hp: 35,
    attack: 55,
    defense: 40,
    specialAttack: 50,
    specialDefense: 50,
    speed: 90,
    height: 4,
    weight: 60,
    baseExperience: 112,
  }),
  mon({
    id: 157,
    nationalDexNumber: 157,
    name: 'typhlosion',
    generation: 'generation-ii',
    types: ['fire'],
    hp: 78,
    attack: 84,
    defense: 78,
    specialAttack: 109,
    specialDefense: 85,
    speed: 100,
    height: 17,
    weight: 795,
    baseExperience: 240,
  }),
];

export const CARD_EXPANSIONS = [
  { id: 'base1', name: 'Base', series: 'Base', releaseDate: '1999/01/09' },
  { id: 'sv5', name: 'Temporal Forces', series: 'Scarlet & Violet', releaseDate: '2024/03/22' },
];
export const CARD_SERIES = ['Base', 'Scarlet & Violet'];
export const CARD_RARITIES = ['Common', 'Uncommon', 'Rare', 'Double Rare'];
// Cards print the TCG's own energy types, not Pokémon types — "Lightning" and "Colorless"
// have no Pokémon-type equivalent, and a dual-type Pokémon prints as a single energy.
export const CARD_TYPES = ['Colorless', 'Fighting', 'Fire', 'Grass', 'Lightning', 'Metal', 'Water'];
export const CARD_COLLECTIONS = ['Charizard Deck', 'Bulk Box'];

export const cardSchema: QuerySchema<CardListItem> = buildCardQuerySchema(
  CARD_EXPANSIONS,
  CARD_SERIES,
  CARD_RARITIES,
  CARD_TYPES,
  CARD_COLLECTIONS,
);

function card(overrides: Partial<CardListItem>): CardListItem {
  return {
    id: 'x-0',
    name: 'Unknown',
    number: '0',
    setId: 'base1',
    setName: 'Base',
    series: 'Base',
    rarity: 'Common',
    releaseDate: '1999/01/09',
    imageSmall: null,
    imageLarge: null,
    supertype: 'Pokémon',
    variants: [{ position: 0, type: 'normal', subtype: null, stamp: null, label: 'Normal' }],
    pokemonId: 0,
    pokemonName: 'missingno',
    types: [],
    inBoxes: [],
    totalOwned: 0,
    ...overrides,
  };
}

// Trainer and Energy cards link to no Pokémon at all, so pokemonId/pokemonName are null —
// every card-side code path has to tolerate that.
export const TRAINER_CARD: CardListItem = card({
  id: 'base1-102',
  name: "Professor Oak",
  number: '102',
  setId: 'base1',
  setName: 'Base',
  series: 'Base',
  rarity: 'Uncommon',
  releaseDate: '1999/01/09',
  supertype: 'Trainer',
  pokemonId: null,
  pokemonName: null,
  types: [],
  inBoxes: [{ entryId: 5, boxId: 101, boxName: 'Bulk Box', quantity: 2 }],
  totalOwned: 2,
});

export const CARD_FIXTURE: CardListItem[] = [
  card({
    id: 'base1-4',
    name: 'Charizard',
    number: '4',
    setId: 'base1',
    setName: 'Base',
    series: 'Base',
    rarity: 'Rare Holo',
    releaseDate: '1999/01/09',
    pokemonId: 6,
    pokemonName: 'charizard',
    // Fire only — the Pokémon is Fire/Flying, but the card prints one energy.
    types: ['Fire'],
    // Matches production: four holo printings that are only told apart by subtype/stamp.
    variants: [
      { position: 0, type: 'holo', subtype: 'unlimited', stamp: null, label: 'Holo · Unlimited' },
      {
        position: 1,
        type: 'holo',
        subtype: 'shadowless',
        stamp: '1st-edition',
        label: 'Holo · Shadowless · 1st Edition',
      },
    ],
    inBoxes: [{ entryId: 1, boxId: 100, boxName: 'Charizard Deck', quantity: 2 }],
    totalOwned: 2,
  }),
  card({
    id: 'sv5-99',
    name: 'Iron Boulder ex',
    number: '99',
    setId: 'sv5',
    setName: 'Temporal Forces',
    series: 'Scarlet & Violet',
    rarity: 'Double Rare',
    releaseDate: '2024/03/22',
    pokemonId: 1022,
    pokemonName: 'iron-boulder',
    types: ['Fighting'],
    inBoxes: [],
    totalOwned: 0,
  }),
  card({
    id: 'base1-2',
    name: 'Blastoise',
    number: '2',
    setId: 'base1',
    setName: 'Base',
    series: 'Base',
    rarity: 'Rare Holo',
    releaseDate: '1999/01/09',
    pokemonId: 9,
    pokemonName: 'blastoise',
    types: ['Water'],
    inBoxes: [{ entryId: 2, boxId: 101, boxName: 'Bulk Box', quantity: 1 }],
    totalOwned: 1,
  }),
  card({
    id: 'base1-15',
    name: 'Venusaur',
    number: '15',
    setId: 'base1',
    setName: 'Base',
    series: 'Base',
    rarity: 'Rare Holo',
    releaseDate: '1999/01/09',
    pokemonId: 3,
    pokemonName: 'venusaur',
    types: ['Grass'],
    inBoxes: [],
    totalOwned: 0,
  }),
  card({
    id: 'base1-58',
    name: 'Pikachu',
    number: '58',
    setId: 'base1',
    setName: 'Base',
    series: 'Base',
    rarity: 'Common',
    releaseDate: '1999/01/09',
    pokemonId: 25,
    pokemonName: 'pikachu',
    // "Lightning" on a card; the Pokémon's type is "electric".
    types: ['Lightning'],
    variants: [
      { position: 0, type: 'normal', subtype: null, stamp: null, label: 'Normal' },
      { position: 1, type: 'reverse', subtype: null, stamp: null, label: 'Reverse holo' },
    ],
    inBoxes: [
      { entryId: 3, boxId: 100, boxName: 'Charizard Deck', quantity: 1 },
      { entryId: 4, boxId: 101, boxName: 'Bulk Box', quantity: 3 },
    ],
    totalOwned: 4,
  }),
];

// Generates a large synthetic dataset for performance testing — shaped like real
// CardListItem data (varied names/sets/rarities/types) rather than N copies of one card,
// since filter cost depends on actually touching different field values.
export function generateCardDataset(count: number): CardListItem[] {
  const names = ['Charizard', 'Pikachu', 'Bulbasaur', 'Mewtwo', 'Gengar', 'Snorlax'];
  const rarities = CARD_RARITIES;
  const types = CARD_TYPES;
  return Array.from({ length: count }, (_, i) =>
    card({
      id: `set${i % 174}-${i}`,
      name: names[i % names.length] + (i % 3 === 0 ? ' ex' : ''),
      number: String(i),
      setId: `set${i % 174}`,
      setName: `Set ${i % 174}`,
      series: `Series ${i % 20}`,
      rarity: rarities[i % rarities.length],
      releaseDate: `${1999 + (i % 26)}/01/01`,
      pokemonId: i % 1025,
      pokemonName: names[i % names.length].toLowerCase(),
      types: [types[i % types.length]],
      inBoxes: i % 7 === 0 ? [{ entryId: i, boxId: 100, boxName: 'Bulk Box', quantity: 1 }] : [],
      totalOwned: i % 7 === 0 ? 1 : 0,
    }),
  );
}
