/**
 * Every set and every card, from the pokemon-tcg-data dataset.
 *
 * The pokemontcg.io REST API proved unreliable (frequent 500/502/504s) and, for a real slice
 * of cards -- the sv5 "ex" Paradox Pokémon among them -- simply omits nationalPokedexNumbers
 * that the data actually has. pokemon-tcg-data is the open dataset that API is generated
 * from: static per-set JSON on GitHub's CDN, far more reliable, and correct where the live
 * API was not.
 *
 * Writes are collected per set and sent in batches. The old job issued one statement per
 * card, plus one per printed energy type, plus one per Pokémon link -- around sixty thousand
 * for a full run, which is tolerable against a local file and not against a network.
 */
import { fetchJson, sleep } from './_http.mjs';
import { upsertAll, selectAll, reconcile, deleteForCards } from './_db.mjs';

const RAW_BASE = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master';
const SETS_URL = `${RAW_BASE}/sets/en.json`;
const cardsUrl = (setId) => `${RAW_BASE}/cards/en/${setId}.json`;
const REQUEST_DELAY_MS = 80;
const RETRIES = 5;
const BACKOFF_MS = 500;

// The TCG spells the region out in the card name itself -- "Galarian Articuno", "Alolan
// Vulpix" -- which is how those cards are redirected to the variant rather than the base form.
const REGION_LABELS = ['Alolan', 'Galarian', 'Hisuian', 'Paldean'];

const normalizeCardName = (name) => (name ?? '')
  .toLowerCase()
  .replace(/\b(ex|gx|v|vmax|vstar|break|prime|lv\.x|star|c)\b/gi, '')
  .replace(/[^a-z ]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Drops artwork hosted by Scrydex.
 *
 * Only set symbols now. Card artwork is no longer stored as a URL at all -- the images are
 * vendored onto the device and the client names them from the card id -- so the only thing
 * left to screen is the symbol on a set.
 *
 * Scrydex is the one image source in this pipeline with binding terms, and they prohibit
 * redistributing or mirroring, as well as use as a wholesale data source -- which is exactly
 * what caching art onto a device amounts to. The other hosts are silent or, in PokéAPI's
 * case, actively encourage caching.
 *
 * Nothing is lost by refusing them: every card arriving with a Scrydex URL is also covered by
 * TCGdex, whose image the enrichment pass fills in afterwards. Returning null leaves the
 * field for that pass rather than storing a URL we have agreed not to copy.
 */
const usableImage = (url) =>
  !url || /(^https?:)?\/\/([a-z0-9-]+\.)*scrydex\.com\//i.test(url) ? null : url;

export async function syncTcgCards({ onProgress } = {}) {
  // Regional variants share their base form's dex number, so a plain dex lookup is ambiguous.
  // Default varieties are indexed last so they win: a card with a bare dex number and no
  // region in its name -- the overwhelming majority -- should land on the base form.
  const pokemon = await selectAll('pokemon', 'id,name,national_dex_number,is_default_variety,variant_label');
  const dexMap = new Map();
  const regionalDexMap = new Map();
  const nameToDex = new Map();
  for (const p of [...pokemon].sort((a, b) => Number(a.is_default_variety) - Number(b.is_default_variety))) {
    dexMap.set(p.national_dex_number, p.id);
    if (p.variant_label) regionalDexMap.set(`${p.national_dex_number}|${p.variant_label}`, p.id);
    nameToDex.set(p.name.replace(/-/g, ' '), p.national_dex_number);
  }

  const sets = await fetchJson(SETS_URL, { retries: RETRIES, backoffMs: BACKOFF_MS });

  const setRows = [];
  const cardRows = [];
  const typeRows = [];
  const linkRows = [];
  const relinkByName = [];      // cards whose stale links must go before the new ones land
  const failedSets = [];
  let cardsSeen = 0;
  let cardsLinked = 0;

  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];

    setRows.push({
      id: set.id,
      name: set.name ?? null,
      series: set.series ?? null,
      release_date: set.releaseDate ?? null,
      symbol_url: usableImage(set.images?.symbol),
      logo_url: set.images?.logo ?? null,
    });

    let cards;
    try {
      cards = await fetchJson(cardsUrl(set.id), { retries: RETRIES, backoffMs: BACKOFF_MS });
    } catch (err) {
      console.error(`   giving up on set ${set.id} after retries: ${err.message}`);
      failedSets.push(set.id);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    for (const card of cards) {
      const dexNumbers = card.nationalPokedexNumbers ?? [];
      const region = card.supertype === 'Pokémon'
        ? REGION_LABELS.find((r) => card.name?.startsWith(`${r} `))
        : undefined;

      let pokemonIds = dexNumbers
        .map((dex) => (region ? regionalDexMap.get(`${dex}|${region}`) : undefined) ?? dexMap.get(dex))
        .filter((id) => id !== undefined);

      // A small slice of cards ship with no dex number at all and can never link the primary
      // way. Match the card's own name against a Pokémon name once suffixes like ex/V/VMAX
      // are stripped -- exact match only, never substring, so this cannot cross-link two
      // different Pokémon the way an older name-search sync once did.
      if (pokemonIds.length === 0 && card.supertype === 'Pokémon') {
        const dex = nameToDex.get(normalizeCardName(card.name));
        const id = dex !== undefined ? dexMap.get(dex) : undefined;
        if (id !== undefined) {
          pokemonIds = [id];
          // No authoritative dex number, so any existing link is leftover from an older and
          // less precise pass and may point at the wrong Pokémon.
          relinkByName.push(card.id);
        }
      }

      cardRows.push({
        id: card.id,
        name: card.name ?? null,
        number: card.number ?? null,
        set_id: card.set?.id ?? set.id,
        set_name: card.set?.name ?? set.name,
        series: card.set?.series ?? set.series,
        rarity: card.rarity ?? null,
        release_date: card.set?.releaseDate ?? set.releaseDate,
        supertype: card.supertype ?? null,
        illustrator: card.artist ?? null,
      });

      // The card's own printed energy type, which regularly differs from the Pokémon's types.
      (card.types ?? []).forEach((type, slot) => typeRows.push({ card_id: card.id, type, slot }));

      // Trainer, Energy, Supporter, Stadium, Item and Tool cards have no dex number by
      // definition, so they link to nothing. They are still real cards a collector owns and
      // files, so they are stored regardless and simply carry no Pokémon association.
      for (const pokemonId of pokemonIds) linkRows.push({ card_id: card.id, pokemon_id: pokemonId });
      if (pokemonIds.length > 0) cardsLinked++;
    }

    cardsSeen += cards.length;
    onProgress?.({ synced: cardRows.length, cardsSeen, page: i + 1, totalPages: sets.length });
    await sleep(REQUEST_DELAY_MS);
  }

  await upsertAll('tcg_sets', setRows, 'id');
  await upsertAll('tcg_cards', cardRows, 'id');

  // Types are upserted, then any a card no longer prints are removed -- rather than clearing
  // every card's types first, which would leave the whole catalogue untyped mid-run.
  await upsertAll('tcg_card_types', typeRows, 'card_id,type');
  await reconcile('tcg_card_types', 'card_id', 'type', typeRows);

  await deleteForCards('tcg_card_pokemon', 'card_id', relinkByName);
  await upsertAll('tcg_card_pokemon', linkRows, 'card_id,pokemon_id');

  if (failedSets.length) {
    console.error(`   ${failedSets.length} set(s) could not be fetched (${failedSets.join(', ')}). Re-run to fill gaps.`);
  }

  return {
    synced: cardRows.length,
    cardsLinked,
    cardsSeen,
    failedSets,
    recoveredByName: relinkByName.length,
  };
}
