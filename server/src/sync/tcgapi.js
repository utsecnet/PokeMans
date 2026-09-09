import { all, run, upsert } from '../db/index.js';
import { fetchJson, sleep } from './http.js';

// The pokemontcg.io REST API proved unreliable (frequent 500/502/504s) and, for a real
// slice of cards (e.g. the sv5 "ex" Paradox Pokémon), simply omits nationalPokedexNumbers
// that the data actually has. pokemon-tcg-data is the open dataset that API is generated
// from — static per-set JSON files on GitHub's CDN, far more reliable, and it has the
// correct nationalPokedexNumbers where the live API didn't. Card images still come from
// images.pokemontcg.io, unchanged.
const RAW_BASE = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master';
const SETS_URL = `${RAW_BASE}/sets/en.json`;
const cardsUrl = (setId) => `${RAW_BASE}/cards/en/${setId}.json`;
const REQUEST_DELAY_MS = 80;
const RETRIES = 5;
const BACKOFF_MS = 500;

// Regional variants (Alolan Vulpix, Galarian Articuno, ...) share their base form's
// national dex number, so a plain dex-number lookup is ambiguous between them. Order
// default varieties last so they win the overwrite — cards with a bare dex number and no
// region context in their name (the overwhelming majority) should land on the base form.
function buildDexMap() {
  const rows = all(
    'SELECT id, national_dex_number as dex FROM pokemon ORDER BY is_default_variety ASC',
  );
  const map = new Map();
  for (const row of rows) map.set(row.dex, row.id);
  return map;
}

// The TCG's own naming convention spells the region out in the card name itself, e.g.
// "Galarian Articuno" / "Alolan Vulpix" — used to redirect those specific cards to the
// matching variant instead of the default dex-map entry.
const REGION_LABELS = ['Alolan', 'Galarian', 'Hisuian', 'Paldean'];

function buildRegionalDexMap() {
  const rows = all(
    "SELECT id, national_dex_number as dex, variant_label as label FROM pokemon WHERE variant_label IS NOT NULL",
  );
  const map = new Map();
  for (const row of rows) map.set(`${row.dex}|${row.label}`, row.id);
  return map;
}

// A small slice of cards ship with no nationalPokedexNumbers at all, so they can never
// link via the primary path. Fall back to matching the card's own name against a Pokémon
// name once suffixes like "ex"/"V"/"VMAX" are stripped — exact match only, never
// substring/fuzzy, so this can't cross-link two different Pokémon the way an old
// name-search-based sync once did.
function buildNameToDexMap() {
  const rows = all('SELECT national_dex_number as dex, name FROM pokemon');
  const map = new Map();
  for (const row of rows) map.set(row.name.replace(/-/g, ' '), row.dex);
  return map;
}

function normalizeCardName(name) {
  return (name ?? '')
    .toLowerCase()
    .replace(/\b(ex|gx|v|vmax|vstar|break|prime|lv\.x|star|c)\b/gi, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Drops artwork hosted by Scrydex.
 *
 * Scrydex is the one image source in this pipeline with binding terms, and they prohibit
 * "redistribute, mirror, or commercially exploit" as well as use as a "wholesale data
 * source" — which is exactly what caching art onto a device for offline use amounts to. The
 * other three hosts are silent or, in PokéAPI's case, actively encourage caching.
 *
 * Nothing is lost by refusing them: every card that arrives with a Scrydex URL is also
 * covered by TCGdex, whose image the enrichment pass fills in afterwards. Returning null
 * here simply leaves the field for that pass rather than storing a URL we have agreed not
 * to copy.
 */
function usableImage(url) {
  if (!url) return null;
  return /(^https?:)?\/\/([a-z0-9-]+\.)*scrydex\.com\//i.test(url) ? null : url;
}

export async function syncTcgCards({ onProgress } = {}) {
  const dexMap = buildDexMap();
  const regionalDexMap = buildRegionalDexMap();
  const nameToDex = buildNameToDexMap();

  const sets = await fetchJson(SETS_URL, { retries: RETRIES, backoffMs: BACKOFF_MS });

  let cardsSeen = 0;
  let cardsStored = 0;
  let cardsLinked = 0;
  let recoveredByName = 0;
  const failedSets = [];

  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];

    // Once per set, not once per card: the symbol is the same string for all of them.
    upsert(
      'tcg_sets',
      {
        id: set.id,
        name: set.name ?? null,
        series: set.series ?? null,
        release_date: set.releaseDate ?? null,
        symbol_url: usableImage(set.images?.symbol),
        logo_url: set.images?.logo ?? null,
      },
      ['id'],
    );

    let cards;
    try {
      cards = await fetchJson(cardsUrl(set.id), { retries: RETRIES, backoffMs: BACKOFF_MS });
    } catch (err) {
      console.error(`TCG sync: giving up on set ${set.id} after retries: ${err.message}`);
      failedSets.push(set.id);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    for (const card of cards) {
      const dexNumbers = card.nationalPokedexNumbers ?? [];
      const region =
        card.supertype === 'Pokémon'
          ? REGION_LABELS.find((r) => card.name?.startsWith(`${r} `))
          : undefined;
      let pokemonIds = dexNumbers
        .map((dex) => (region ? regionalDexMap.get(`${dex}|${region}`) : undefined) ?? dexMap.get(dex))
        .filter((id) => id !== undefined);
      let matchedByName = false;

      if (pokemonIds.length === 0 && card.supertype === 'Pokémon') {
        const dex = nameToDex.get(normalizeCardName(card.name));
        const pokemonId = dex !== undefined ? dexMap.get(dex) : undefined;
        if (pokemonId !== undefined) {
          pokemonIds = [pokemonId];
          matchedByName = true;
        }
      }

      if (matchedByName) {
        // This card has no authoritative dex number in the data, so any existing link for
        // it is leftover from an older, less precise matching pass and may point at the
        // wrong Pokémon — clear it before relinking by name.
        run('DELETE FROM tcg_card_pokemon WHERE card_id = @cardId', { cardId: card.id });
        recoveredByName++;
      }

      upsert(
        'tcg_cards',
        {
          id: card.id,
          name: card.name ?? null,
          number: card.number ?? null,
          set_id: card.set?.id ?? set.id,
          set_name: card.set?.name ?? set.name,
          series: card.set?.series ?? set.series,
          rarity: card.rarity ?? null,
          release_date: card.set?.releaseDate ?? set.releaseDate,
          image_small: usableImage(card.images?.small),
          image_large: usableImage(card.images?.large),
          supertype: card.supertype ?? null,
          illustrator: card.artist ?? null,
        },
        ['id'],
      );

      // The card's own printed energy type, which regularly differs from the Pokémon's
      // types — replaced wholesale per card so a re-sync can't leave stale rows behind.
      run('DELETE FROM tcg_card_types WHERE card_id = @cardId', { cardId: card.id });
      (card.types ?? []).forEach((type, slot) => {
        run(
          'INSERT OR IGNORE INTO tcg_card_types (card_id, type, slot) VALUES (@cardId, @type, @slot)',
          { cardId: card.id, type, slot },
        );
      });

      // Trainer, Energy, Supporter, Stadium, Item and Tool cards have no dex number by
      // definition, so they link to nothing — they're still real cards a collector owns
      // and files, so they're stored regardless and simply carry no Pokémon association.
      for (const pokemonId of pokemonIds) {
        run(
          'INSERT OR IGNORE INTO tcg_card_pokemon (card_id, pokemon_id) VALUES (@cardId, @pokemonId)',
          { cardId: card.id, pokemonId },
        );
      }
      cardsStored++;
      if (pokemonIds.length > 0) cardsLinked++;
    }

    cardsSeen += cards.length;
    onProgress?.({ synced: cardsStored, cardsSeen, totalCards: null, page: i + 1, totalPages: sets.length });
    await sleep(REQUEST_DELAY_MS);
  }

  if (failedSets.length > 0) {
    console.error(
      `TCG sync: ${failedSets.length} set(s) could not be fetched (${failedSets.join(', ')}). Re-run the sync to fill gaps.`,
    );
  }

  return {
    synced: cardsStored,
    cardsLinked,
    cardsSeen,
    totalCards: cardsSeen,
    failedPages: failedSets,
    recoveredByName,
  };
}
