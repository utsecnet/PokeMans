import type { CardListItem, Expansion } from '../types.ts';
import type { QuerySchema } from './queryLanguage.ts';

export function buildCardQuerySchema(
  expansions: Expansion[],
  series: string[],
  rarities: string[],
  types: string[],
  collections: string[],
): QuerySchema<CardListItem> {
  return {
    defaultTextFields: ['name', 'pokemon'],
    fields: [
      {
        key: 'collection',
        label: 'Collection',
        aliases: ['box', 'location'],
        type: 'list',
        get: (c) => c.inBoxes.map((b) => b.boxName),
        suggestions: collections,
      },
      { key: 'name', label: 'Card name', type: 'text', get: (c) => c.name },
      { key: 'pokemon', label: 'Pokémon', type: 'text', get: (c) => c.pokemonName },
      {
        key: 'supertype',
        label: 'Card kind',
        aliases: ['kind'],
        type: 'text',
        get: (c) => c.supertype,
        suggestions: ['Pokémon', 'Trainer', 'Energy'],
      },
      {
        key: 'set',
        label: 'Set',
        aliases: ['expansion'],
        type: 'text',
        get: (c) => c.setName,
        suggestions: expansions.map((e) => e.name),
      },
      { key: 'series', label: 'Series', type: 'text', get: (c) => c.series, suggestions: series },
      { key: 'rarity', label: 'Rarity', type: 'text', get: (c) => c.rarity, suggestions: rarities },
      { key: 'type', label: 'Type', aliases: ['types'], type: 'list', get: (c) => c.types, suggestions: types },
      {
        key: 'variant',
        label: 'Print variant',
        aliases: ['variants', 'printing'],
        type: 'list',
        // Every word that identifies a printing, so "variant:holo" still works while
        // "variant:shadowless" and "variant:1st-edition" now do too.
        get: (c) =>
          c.variants.flatMap((v) => [v.type, v.subtype, ...String(v.stamp ?? '').split(',')])
            .filter((v): v is string => !!v),
        suggestions: ['normal', 'reverse', 'holo', 'shadowless', 'unlimited', '1st-edition'],
      },
      { key: 'number', label: 'Number', type: 'text', get: (c) => c.number },
      { key: 'owned', label: 'Owned', type: 'boolean', get: (c) => c.totalOwned > 0, suggestions: ['true', 'false'] },
      {
        key: 'release',
        label: 'Release date',
        aliases: ['releasedate', 'released'],
        type: 'date',
        get: (c) => c.releaseDate,
      },
    ],
  };
}
