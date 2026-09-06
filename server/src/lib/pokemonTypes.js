import { all } from '../db/index.js';

const TYPE_ROWS_SQL = `SELECT pt.pokemon_id as pokemonId, t.name
   FROM pokemon_types pt JOIN types t ON t.id = pt.type_id`;

// Above this many distinct Pokémon, bind-a-parameter-per-id costs more than just reading
// the whole (small, bounded-by-total-Pokémon-count) table — which is the shape the
// advanced search bar's 25,000-row bulk fetch produces.
const NARROW_LIMIT = 400;

// Type rows for a set of Pokémon, as {pokemonId, name} in slot order. A normal 60-row page
// only touches ~60 Pokémon, so reading just those is far cheaper than scanning every type
// row in the database (measured ~0.14ms versus ~1.6ms); the bulk path keeps the old
// whole-table read, where that tradeoff reverses.
export function typeRowsFor(pokemonIds) {
  const unique = [...new Set(pokemonIds.filter((id) => id != null))];
  if (unique.length === 0) return [];

  if (unique.length > NARROW_LIMIT) {
    return all(`${TYPE_ROWS_SQL} ORDER BY pt.pokemon_id, pt.slot`);
  }

  const params = {};
  const keys = unique.map((id, i) => {
    params[`p${i}`] = id;
    return `@p${i}`;
  });
  return all(
    `${TYPE_ROWS_SQL} WHERE pt.pokemon_id IN (${keys.join(', ')}) ORDER BY pt.pokemon_id, pt.slot`,
    params,
  );
}

// Groups type rows by Pokémon id, for callers that need to look types up per row.
export function typesByPokemon(pokemonIds) {
  const byPokemon = new Map();
  for (const row of typeRowsFor(pokemonIds)) {
    if (!byPokemon.has(row.pokemonId)) byPokemon.set(row.pokemonId, []);
    byPokemon.get(row.pokemonId).push(row.name);
  }
  return byPokemon;
}
