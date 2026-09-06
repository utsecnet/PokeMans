import { all, get, run, upsert } from '../db/index.js';
import { fetchJson, sleep } from './http.js';

const BASE = 'https://pokeapi.co/api/v2';
const REQUEST_DELAY_MS = 40;

// Only real regional forms are synced as separate rows — cosmetic/costume varieties like
// "pikachu-alola-cap" (a Pikachu wearing an Alola-themed cap, not a regional evolution)
// would false-positive on a substring check, so this requires the region to be the exact
// trailing segment of the variety name.
const REGIONAL_SUFFIXES = {
  alola: 'Alolan',
  galar: 'Galarian',
  hisui: 'Hisuian',
  paldea: 'Paldean',
};

function deriveRegionalVariantLabel(varietyName) {
  for (const [suffix, label] of Object.entries(REGIONAL_SUFFIXES)) {
    if (varietyName.endsWith(`-${suffix}`)) return label;
  }
  return null;
}

function getOrCreateId(table, name) {
  const existing = get(`SELECT id FROM ${table} WHERE name = @name`, { name });
  if (existing) return existing.id;
  run(`INSERT INTO ${table} (name) VALUES (@name)`, { name });
  return get(`SELECT id FROM ${table} WHERE name = @name`, { name }).id;
}

function cleanFlavorText(text) {
  return text ? text.replace(/[\n\f\r]+/g, ' ').replace(/\s+/g, ' ').trim() : null;
}

async function syncPokemonVariety(pokemonUrl, { nationalDexNumber, generation, flavorText, isDefaultVariety, variantLabel }) {
  const pokemon = await fetchJson(pokemonUrl);
  await sleep(REQUEST_DELAY_MS);

  const artworkUrl =
    pokemon.sprites?.other?.['official-artwork']?.front_default ??
    pokemon.sprites?.front_default ??
    null;

  upsert(
    'pokemon',
    {
      id: pokemon.id,
      national_dex_number: nationalDexNumber,
      name: pokemon.name,
      generation,
      height: pokemon.height,
      weight: pokemon.weight,
      base_experience: pokemon.base_experience,
      flavor_text: flavorText,
      sprite_url: pokemon.sprites?.front_default ?? null,
      artwork_url: artworkUrl,
      is_default_variety: isDefaultVariety ? 1 : 0,
      variant_label: variantLabel ?? null,
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

  return pokemon.id;
}

async function syncOnePokemon(speciesId, chainUrls) {
  const species = await fetchJson(`${BASE}/pokemon-species/${speciesId}`);
  await sleep(REQUEST_DELAY_MS);

  const flavorEntry = species.flavor_text_entries.find((e) => e.language.name === 'en');
  const flavorText = cleanFlavorText(flavorEntry?.flavor_text);
  const generation = species.generation?.name ?? null;

  const defaultVariety = species.varieties.find((v) => v.is_default) ?? species.varieties[0];
  await syncPokemonVariety(defaultVariety.pokemon.url, {
    nationalDexNumber: species.id,
    generation,
    flavorText,
    isDefaultVariety: true,
    variantLabel: null,
  });

  for (const variety of species.varieties) {
    if (variety.is_default) continue;
    const variantLabel = deriveRegionalVariantLabel(variety.pokemon.name);
    if (!variantLabel) continue;
    await syncPokemonVariety(variety.pokemon.url, {
      nationalDexNumber: species.id,
      generation,
      flavorText,
      isDefaultVariety: false,
      variantLabel,
    });
  }

  if (species.evolution_chain?.url) {
    chainUrls.add(species.evolution_chain.url);
  }
}

function walkEvolutionChain(node, edges) {
  for (const next of node.evolves_to ?? []) {
    edges.push({
      fromName: node.species.name,
      toName: next.species.name,
      // Keep every listed evolution method, not just the first — a second entry (e.g.
      // Vulpix -> Ninetales has both fire-stone and ice-stone) is usually how a regional
      // variant of this species evolves, since PokeAPI doesn't otherwise tag which method
      // belongs to which region.
      details: (next.evolution_details ?? []).map((d) => ({
        trigger: d.trigger?.name ?? null,
        minLevel: d.min_level ?? null,
        item: d.item?.name ?? null,
      })),
    });
    walkEvolutionChain(next, edges);
  }
}

function upsertEvolutionEdge(pokemonId, evolvesIntoId, detail) {
  run(
    `INSERT INTO evolutions (pokemon_id, evolves_into_id, trigger, min_level, item)
     VALUES (@pokemonId, @evolvesIntoId, @trigger, @minLevel, @item)
     ON CONFLICT(pokemon_id, evolves_into_id) DO UPDATE SET
       trigger = excluded.trigger, min_level = excluded.min_level, item = excluded.item`,
    {
      pokemonId,
      evolvesIntoId,
      trigger: detail.trigger ?? null,
      minLevel: detail.minLevel ?? null,
      item: detail.item ?? null,
    },
  );
}

async function syncEvolutionChains(chainUrls) {
  for (const url of chainUrls) {
    const chain = await fetchJson(url);
    await sleep(REQUEST_DELAY_MS);
    const edges = [];
    walkEvolutionChain(chain.chain, edges);

    for (const edge of edges) {
      const from = get('SELECT id, national_dex_number as dex FROM pokemon WHERE name = @name', {
        name: edge.fromName,
      });
      const to = get('SELECT id, national_dex_number as dex FROM pokemon WHERE name = @name', {
        name: edge.toName,
      });
      if (!from || !to) continue;

      const primaryDetail = edge.details[0] ?? {};
      upsertEvolutionEdge(from.id, to.id, primaryDetail);

      // Mirror this edge onto matching regional variants of both species, if any (e.g.
      // Vulpix-Alola -> Ninetales-Alola). Best-effort: prefer a second listed evolution
      // method (see walkEvolutionChain), falling back to the default one if there isn't
      // one — still correct in the common case where a region doesn't change the method.
      const fromVariants = all(
        'SELECT id, variant_label as label FROM pokemon WHERE national_dex_number = @dex AND is_default_variety = 0',
        { dex: from.dex },
      );
      for (const variant of fromVariants) {
        const toVariant = get(
          'SELECT id FROM pokemon WHERE national_dex_number = @dex AND variant_label = @label',
          { dex: to.dex, label: variant.label },
        );
        if (!toVariant) continue;
        upsertEvolutionEdge(variant.id, toVariant.id, edge.details[1] ?? primaryDetail);
      }
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
