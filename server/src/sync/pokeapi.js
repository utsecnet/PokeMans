import { db, get, run, upsert } from '../db/index.js';
import { fetchJson, sleep } from './http.js';

const BASE = 'https://pokeapi.co/api/v2';
const REQUEST_DELAY_MS = 40;

function getOrCreateId(table, name) {
  const existing = get(`SELECT id FROM ${table} WHERE name = @name`, { name });
  if (existing) return existing.id;
  run(`INSERT INTO ${table} (name) VALUES (@name)`, { name });
  return get(`SELECT id FROM ${table} WHERE name = @name`, { name }).id;
}

function cleanFlavorText(text) {
  return text ? text.replace(/[\n\f\r]+/g, ' ').replace(/\s+/g, ' ').trim() : null;
}

async function syncOnePokemon(speciesId, chainUrls) {
  const species = await fetchJson(`${BASE}/pokemon-species/${speciesId}`);
  await sleep(REQUEST_DELAY_MS);

  const defaultVariety = species.varieties.find((v) => v.is_default) ?? species.varieties[0];
  const pokemonUrl = defaultVariety.pokemon.url;
  const pokemon = await fetchJson(pokemonUrl);
  await sleep(REQUEST_DELAY_MS);

  const flavorEntry = species.flavor_text_entries.find((e) => e.language.name === 'en');
  const artworkUrl =
    pokemon.sprites?.other?.['official-artwork']?.front_default ??
    pokemon.sprites?.front_default ??
    null;

  upsert(
    'pokemon',
    {
      id: pokemon.id,
      national_dex_number: species.id,
      name: species.name,
      generation: species.generation?.name ?? null,
      height: pokemon.height,
      weight: pokemon.weight,
      base_experience: pokemon.base_experience,
      flavor_text: cleanFlavorText(flavorEntry?.flavor_text),
      sprite_url: pokemon.sprites?.front_default ?? null,
      artwork_url: artworkUrl,
    },
    ['id'],
  );

  for (const t of pokemon.types) {
    const typeId = getOrCreateId('types', t.type.name);
    run(
      `INSERT INTO pokemon_types (pokemon_id, type_id, slot) VALUES (@pokemonId, @typeId, @slot)
       ON CONFLICT(pokemon_id, type_id) DO UPDATE SET slot = excluded.slot`,
      { pokemonId: pokemon.id, typeId, slot: t.slot },
    );
  }

  for (const a of pokemon.abilities) {
    const abilityId = getOrCreateId('abilities', a.ability.name);
    run(
      `INSERT INTO pokemon_abilities (pokemon_id, ability_id, is_hidden, slot)
       VALUES (@pokemonId, @abilityId, @isHidden, @slot)
       ON CONFLICT(pokemon_id, ability_id) DO UPDATE SET is_hidden = excluded.is_hidden, slot = excluded.slot`,
      { pokemonId: pokemon.id, abilityId, isHidden: a.is_hidden ? 1 : 0, slot: a.slot },
    );
  }

  const statMap = {};
  for (const s of pokemon.stats) {
    statMap[s.stat.name] = s.base_stat;
  }
  upsert(
    'stats',
    {
      pokemon_id: pokemon.id,
      hp: statMap.hp ?? 0,
      attack: statMap.attack ?? 0,
      defense: statMap.defense ?? 0,
      special_attack: statMap['special-attack'] ?? 0,
      special_defense: statMap['special-defense'] ?? 0,
      speed: statMap.speed ?? 0,
    },
    ['pokemon_id'],
  );

  if (species.evolution_chain?.url) {
    chainUrls.add(species.evolution_chain.url);
  }
}

function walkEvolutionChain(node, edges) {
  for (const next of node.evolves_to ?? []) {
    const detail = next.evolution_details?.[0];
    edges.push({
      fromName: node.species.name,
      toName: next.species.name,
      trigger: detail?.trigger?.name ?? null,
      minLevel: detail?.min_level ?? null,
      item: detail?.item?.name ?? null,
    });
    walkEvolutionChain(next, edges);
  }
}

async function syncEvolutionChains(chainUrls) {
  for (const url of chainUrls) {
    const chain = await fetchJson(url);
    await sleep(REQUEST_DELAY_MS);
    const edges = [];
    walkEvolutionChain(chain.chain, edges);

    for (const edge of edges) {
      const from = get('SELECT id FROM pokemon WHERE name = @name', { name: edge.fromName });
      const to = get('SELECT id FROM pokemon WHERE name = @name', { name: edge.toName });
      if (!from || !to) continue;
      run(
        `INSERT INTO evolutions (pokemon_id, evolves_into_id, trigger, min_level, item)
         VALUES (@pokemonId, @evolvesIntoId, @trigger, @minLevel, @item)
         ON CONFLICT(pokemon_id, evolves_into_id) DO UPDATE SET
           trigger = excluded.trigger, min_level = excluded.min_level, item = excluded.item`,
        {
          pokemonId: from.id,
          evolvesIntoId: to.id,
          trigger: edge.trigger,
          minLevel: edge.minLevel,
          item: edge.item,
        },
      );
    }
  }
}

export async function syncPokeApi({ start = 1, end, onProgress } = {}) {
  let rangeEnd = end;
  if (!rangeEnd) {
    const countRes = await fetchJson(`${BASE}/pokemon-species?limit=1`);
    rangeEnd = countRes.count;
  }

  const chainUrls = new Set();
  let synced = 0;

  for (let id = start; id <= rangeEnd; id++) {
    try {
      await syncOnePokemon(id, chainUrls);
      synced++;
      onProgress?.({ id, total: rangeEnd, synced, phase: 'species' });
    } catch (err) {
      console.error(`Failed to sync species ${id}:`, err.message);
    }
  }

  onProgress?.({ phase: 'evolutions', chains: chainUrls.size });
  await syncEvolutionChains(chainUrls);

  return { synced, total: rangeEnd };
}
