/**
 * Every Pokémon, its types, abilities, stats and evolutions, from PokéAPI.
 *
 * PokéAPI asks that results be cached rather than re-fetched, which is what this is: one
 * pass that lands the whole species list in our own database so the app never calls them.
 *
 * Three things here were a round trip each against the old local file and are now resolved
 * from memory, because a round trip to a hosted database is not a free operation:
 *
 *   - type and ability ids, which used to be a select-then-insert-then-select per type per
 *     Pokémon: about five thousand statements to learn eighteen type names
 *   - the name-to-id lookup each evolution edge needs, which was a query per edge
 *   - the rows themselves, which went in one at a time and now go in batches
 */
import { fetchJson, sleep } from './_http.mjs';
import { db, upsertAll, selectAll } from './_db.mjs';

const BASE = 'https://pokeapi.co/api/v2';
const REQUEST_DELAY_MS = 40;

// Only real regional forms are synced as separate rows -- cosmetic varieties like
// "pikachu-alola-cap" (a Pikachu in a hat, not a regional evolution) would false-positive on
// a substring check, so the region must be the exact trailing segment of the variety name.
const REGIONAL_SUFFIXES = {
  alola: 'Alolan',
  galar: 'Galarian',
  hisui: 'Hisuian',
  paldea: 'Paldean',
};

const regionalLabel = (varietyName) => {
  for (const [suffix, label] of Object.entries(REGIONAL_SUFFIXES)) {
    if (varietyName.endsWith(`-${suffix}`)) return label;
  }
  return null;
};

const cleanFlavorText = (text) =>
  text ? text.replace(/[\n\f\r]+/g, ' ').replace(/\s+/g, ' ').trim() : null;

/**
 * Names to ids for a lookup table, creating any that are new.
 *
 * Read once, written once. Types and abilities are a closed set that barely changes between
 * runs, so the common case adds nothing at all.
 */
async function nameIndex(table, names) {
  const existing = await selectAll(table, 'id,name');
  const index = new Map(existing.map((r) => [r.name, r.id]));
  const missing = [...names].filter((n) => !index.has(n));
  if (missing.length) {
    const { data, error } = await db.from(table).insert(missing.map((name) => ({ name }))).select('id,name');
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of data) index.set(r.name, r.id);
  }
  return index;
}

/** Walks a chain into flat edges, keeping every listed evolution method. */
function walkChain(node, edges) {
  for (const next of node.evolves_to ?? []) {
    edges.push({
      fromName: node.species.name,
      toName: next.species.name,
      // Not just the first method. A second entry (Vulpix to Ninetales lists both fire-stone
      // and ice-stone) is usually how the regional variant evolves, since PokéAPI does not
      // otherwise tag which method belongs to which region.
      details: (next.evolution_details ?? []).map((d) => ({
        trigger: d.trigger?.name ?? null,
        min_level: d.min_level ?? null,
        item: d.item?.name ?? null,
      })),
    });
    walkChain(next, edges);
  }
}

export async function syncPokeApi({ start = 1, end, onProgress } = {}) {
  const rangeEnd = end ?? (await fetchJson(`${BASE}/pokemon-species?limit=1`)).count;

  const pokemonRows = [];
  const statRows = [];
  const typeLinks = [];      // resolved to ids after the fetch loop
  const abilityLinks = [];
  const typeNames = new Set();
  const abilityNames = new Set();
  const chainUrls = new Set();
  const failures = [];

  async function readVariety(url, meta) {
    const p = await fetchJson(url);
    await sleep(REQUEST_DELAY_MS);

    pokemonRows.push({
      id: p.id,
      national_dex_number: meta.nationalDexNumber,
      name: p.name,
      generation: meta.generation,
      height: p.height,
      weight: p.weight,
      base_experience: p.base_experience,
      flavor_text: meta.flavorText,
      sprite_url: p.sprites?.front_default ?? null,
      artwork_url: p.sprites?.other?.['official-artwork']?.front_default ?? p.sprites?.front_default ?? null,
      is_default_variety: meta.isDefaultVariety,
      variant_label: meta.variantLabel ?? null,
    });

    for (const t of p.types) {
      typeNames.add(t.type.name);
      typeLinks.push({ pokemon_id: p.id, typeName: t.type.name, slot: t.slot });
    }
    for (const a of p.abilities) {
      abilityNames.add(a.ability.name);
      abilityLinks.push({ pokemon_id: p.id, abilityName: a.ability.name, is_hidden: a.is_hidden, slot: a.slot });
    }

    const stat = Object.fromEntries(p.stats.map((s) => [s.stat.name, s.base_stat]));
    statRows.push({
      pokemon_id: p.id,
      hp: stat.hp ?? 0,
      attack: stat.attack ?? 0,
      defense: stat.defense ?? 0,
      special_attack: stat['special-attack'] ?? 0,
      special_defense: stat['special-defense'] ?? 0,
      speed: stat.speed ?? 0,
    });
  }

  for (let id = start; id <= rangeEnd; id++) {
    try {
      const species = await fetchJson(`${BASE}/pokemon-species/${id}`);
      await sleep(REQUEST_DELAY_MS);

      const flavorText = cleanFlavorText(
        species.flavor_text_entries.find((e) => e.language.name === 'en')?.flavor_text);
      const generation = species.generation?.name ?? null;
      const shared = { nationalDexNumber: species.id, generation, flavorText };

      const base = species.varieties.find((v) => v.is_default) ?? species.varieties[0];
      await readVariety(base.pokemon.url, { ...shared, isDefaultVariety: true, variantLabel: null });

      for (const variety of species.varieties) {
        if (variety.is_default) continue;
        const variantLabel = regionalLabel(variety.pokemon.name);
        if (!variantLabel) continue;
        await readVariety(variety.pokemon.url, { ...shared, isDefaultVariety: false, variantLabel });
      }

      if (species.evolution_chain?.url) chainUrls.add(species.evolution_chain.url);
      onProgress?.({ id, total: rangeEnd, synced: pokemonRows.length, phase: 'species' });
    } catch (err) {
      failures.push(id);
      console.error(`   species ${id} failed: ${err.message}`);
    }
  }

  // Pokémon first: the link tables have foreign keys to it.
  await upsertAll('pokemon', pokemonRows, 'id');
  await upsertAll('stats', statRows, 'pokemon_id');

  const types = await nameIndex('types', typeNames);
  const abilities = await nameIndex('abilities', abilityNames);
  await upsertAll('pokemon_types',
    typeLinks.map((l) => ({ pokemon_id: l.pokemon_id, type_id: types.get(l.typeName), slot: l.slot })),
    'pokemon_id,type_id');
  await upsertAll('pokemon_abilities',
    abilityLinks.map((l) => ({
      pokemon_id: l.pokemon_id,
      ability_id: abilities.get(l.abilityName),
      is_hidden: l.is_hidden,
      slot: l.slot,
    })),
    'pokemon_id,ability_id');

  // ---------------------------------------------------------------- evolutions

  onProgress?.({ phase: 'evolutions', chains: chainUrls.size });

  // Every Pokémon now in the database, indexed the three ways the edge walk needs. The old
  // job asked the database for each of these, per edge.
  const known = await selectAll('pokemon', 'id,name,national_dex_number,is_default_variety,variant_label');
  const byName = new Map(known.map((p) => [p.name, p]));
  const variantsOf = new Map();
  const byDexAndLabel = new Map();
  for (const p of known) {
    if (p.variant_label) byDexAndLabel.set(`${p.national_dex_number}|${p.variant_label}`, p.id);
    if (!p.is_default_variety) {
      if (!variantsOf.has(p.national_dex_number)) variantsOf.set(p.national_dex_number, []);
      variantsOf.get(p.national_dex_number).push(p);
    }
  }

  const edgeRows = new Map();                 // keyed so a repeated edge collapses
  const addEdge = (from, to, d) =>
    edgeRows.set(`${from}|${to}`, {
      pokemon_id: from,
      evolves_into_id: to,
      trigger: d.trigger ?? null,
      min_level: d.min_level ?? null,
      item: d.item ?? null,
    });

  for (const url of chainUrls) {
    try {
      const chain = await fetchJson(url);
      await sleep(REQUEST_DELAY_MS);
      const edges = [];
      walkChain(chain.chain, edges);

      for (const edge of edges) {
        const from = byName.get(edge.fromName);
        const to = byName.get(edge.toName);
        if (!from || !to) continue;

        const primary = edge.details[0] ?? {};
        addEdge(from.id, to.id, primary);

        // Mirror the edge onto matching regional variants of both species (Alolan Vulpix to
        // Alolan Ninetales). Best effort: prefer the second listed method, falling back to
        // the first, which is still right wherever a region does not change how it evolves.
        for (const variant of variantsOf.get(from.national_dex_number) ?? []) {
          const target = byDexAndLabel.get(`${to.national_dex_number}|${variant.variant_label}`);
          if (target) addEdge(variant.id, target, edge.details[1] ?? primary);
        }
      }
    } catch (err) {
      console.error(`   evolution chain failed: ${err.message}`);
    }
  }

  await upsertAll('evolutions', [...edgeRows.values()], 'pokemon_id,evolves_into_id');

  return {
    synced: pokemonRows.length,
    total: rangeEnd,
    stats: statRows.length,
    evolutions: edgeRows.size,
    failures,
  };
}
