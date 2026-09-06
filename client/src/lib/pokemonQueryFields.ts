import type { PokemonSummary } from '../types.ts';
import type { QuerySchema } from './queryLanguage.ts';
import { formatGeneration } from './format.ts';

function genNumber(gen: string | null): string {
  if (!gen) return '';
  return formatGeneration(gen).replace('Gen ', '');
}

export function buildPokemonQuerySchema(types: string[], generations: string[]): QuerySchema<PokemonSummary> {
  return {
    defaultTextFields: ['name'],
    fields: [
      { key: 'name', label: 'Name', type: 'text', get: (p) => p.name },
      {
        key: 'type',
        label: 'Type',
        aliases: ['types'],
        type: 'list',
        get: (p) => p.types,
        suggestions: types,
      },
      {
        key: 'generation',
        label: 'Generation',
        aliases: ['gen'],
        type: 'text',
        get: (p) => genNumber(p.generation),
        suggestions: generations.map(genNumber),
      },
      { key: 'hp', label: 'HP', type: 'number', get: (p) => p.hp },
      { key: 'attack', label: 'Attack', aliases: ['atk'], type: 'number', get: (p) => p.attack },
      { key: 'defense', label: 'Defense', aliases: ['def'], type: 'number', get: (p) => p.defense },
      {
        key: 'specialattack',
        label: 'Sp. Atk',
        aliases: ['spa', 'spatk'],
        type: 'number',
        get: (p) => p.specialAttack,
      },
      {
        key: 'specialdefense',
        label: 'Sp. Def',
        aliases: ['spd', 'spdef'],
        type: 'number',
        get: (p) => p.specialDefense,
      },
      { key: 'speed', label: 'Speed', aliases: ['spe'], type: 'number', get: (p) => p.speed },
      {
        key: 'height',
        label: 'Height (m)',
        type: 'number',
        get: (p) => p.height,
        toRaw: (n) => n * 10,
      },
      {
        key: 'weight',
        label: 'Weight (kg)',
        type: 'number',
        get: (p) => p.weight,
        toRaw: (n) => n * 10,
      },
      {
        key: 'baseexperience',
        label: 'Base XP',
        aliases: ['xp', 'exp'],
        type: 'number',
        get: (p) => p.baseExperience,
      },
    ],
  };
}
