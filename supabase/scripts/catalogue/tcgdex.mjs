/**
 * Lighter card images and printing data, from TCGdex.
 *
 * TCGdex is a second, independent catalogue of the same English cards. The card list is not
 * synced from it -- pokemon-tcg-data is more complete on the sets we carry -- but it has two
 * things that dataset lacks:
 *
 *   - lightweight images: about 19KB of webp against the 180KB png we would otherwise load,
 *     which is the single heaviest thing the card grid pulls
 *   - which printings each card exists in (normal, reverse, holo, first edition), which is
 *     what the whole price model is keyed on
 *
 * So this is an enrichment pass over cards we already have, matched on set and card number.
 * Anything that does not match confidently is left alone.
 */
import { fetchJson, sleep } from './_http.mjs';
import { upsertAll, selectAll, reconcile } from './_db.mjs';

// Nothing is written when this is set. The matching runs in full and reports what it would
// change, which is the only safe way to alter this file: price_map keys on
// (card_ref, variant_position), so a printing that moves position or disappears silently
// strands the price mapping for that card.
const DRY_RUN = process.argv.includes('--dry-run');

const API = 'https://api.tcgdex.net/v2/en';
const GRAPHQL = 'https://api.tcgdex.net/v2/graphql';
const REQUEST_DELAY_MS = 30;
const CONCURRENCY = 4;

/**
 * Sets whose names differ enough between the two catalogues that normalising cannot bridge
 * them. Keyed by our set id, valued by theirs.
 *
 * Each was checked against the upstream set's contents before being written down. Three were
 * added after 71 cards turned out to have no printings at all, which meant no price could
 * ever be mapped to them:
 *
 *   cel25c  "Celebrations: Classic Collection" vs "Celebrations Classic Collection" --
 *           these do normalise to the same string, so the set matched; the cards did not,
 *           because the two catalogues number this set differently (see below).
 *   me55c   "30th Celebration: Classic Collection" vs "30th Classic Collection" -- no
 *           shared normalisation, and it was falling through to the date, where it
 *           collided with the 158-card "30th Celebration" released the same day.
 *   sve     "Scarlet & Violet Energies" vs "Scarlet & Violet Energy" -- plural against
 *           singular. Their id happens to match ours.
 */
const SET_ALIASES = {
  svp: 'svp',
  cel25c: 'cel25cc',
  me55c: '30th-c',
  sve: 'sve',
};

const normName = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The same, with the word the two catalogues disagree about removed.
 *
 * We call the basic energies "Basic Grass Energy"; TCGdex calls them "Grass Energy". All 16
 * cards in Scarlet & Violet Energies matched on number and were then thrown out by the name
 * guard below, so the whole set had no printings and no price could ever reach it. Only the
 * leading word is dropped, so this cannot collapse two genuinely different cards.
 */
const normCardName = (s) => normName(s).replace(/^basic/, '');
// "001" and "1" are the same card; any letter prefix (TG01, SV01) stays intact.
const normNumber = (s) => String(s ?? '').toUpperCase().replace(/^0+(?=\d)/, '');

/**
 * Every card's printings, in one request.
 *
 * Only GraphQL exposes subtype, stamp and foil -- the REST card endpoint returns the same
 * array with prices but no labels, so this is where a printing gets its identity. One
 * request of about 3.8MB rather than twenty thousand individual card fetches.
 */
async function fetchAllVariants() {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ cards { id variants_detailed { type subtype size stamp foil } } }' }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}`);
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors).slice(0, 200)}`);
  const map = new Map();
  for (const card of body.data?.cards ?? []) {
    if (card.variants_detailed?.length) map.set(card.id, card.variants_detailed);
  }
  return map;
}

/**
 * Series wordmarks, matched to our series names.
 *
 * TCGdex serves an extension-less path; .webp is the smallest of the formats it offers. Two
 * of our series ("Other", "NP") are catch-all buckets with no counterpart there and get none.
 */
async function syncSeriesLogos() {
  const ours = new Set((await selectAll('tcg_cards', 'series', (q) => q.not('series', 'is', null)))
    .map((r) => r.series).filter(Boolean));
  const res = await fetch(`${API}/series`);
  if (!res.ok) throw new Error(`TCGdex series returned ${res.status}`);

  const byName = new Map((await res.json()).map((s) => [String(s.name).toLowerCase(), s]));
  const rows = [];
  for (const name of ours) {
    const hit = byName.get(name.toLowerCase());
    if (hit?.logo) rows.push({ name, logo_url: `${hit.logo}.webp` });
  }
  await upsertAll('tcg_series', rows, 'name');
  return rows.length;
}

export async function syncTcgdexEnrichment({ onProgress } = {}) {
  try {
    console.log(`   series logos matched: ${await syncSeriesLogos()}`);
  } catch (err) {
    // A missing wordmark is cosmetic; it must not fail the printing data that follows.
    console.error(`   series logos unavailable: ${err.message}`);
  }

  const ourCards = await selectAll('tcg_cards', 'id,set_id,set_name,number,name,release_date');
  const cardsBySet = new Map();
  const ourSets = new Map();
  for (const c of ourCards) {
    if (!cardsBySet.has(c.set_id)) cardsBySet.set(c.set_id, []);
    cardsBySet.get(c.set_id).push(c);
    const seen = ourSets.get(c.set_id);
    if (!seen) ourSets.set(c.set_id, { id: c.set_id, name: c.set_name, releaseDate: c.release_date });
    else if (c.release_date && c.release_date < seen.releaseDate) seen.releaseDate = c.release_date;
  }

  let variantsById = new Map();
  try {
    variantsById = await fetchAllVariants();
  } catch (err) {
    console.error(`   printing lookup failed (${err.message}); images will still sync.`);
  }

  const setList = await fetchJson(`${API}/sets`, { retries: 5, backoffMs: 400 });

  // Set details carry the card list, fetched with modest concurrency because this API starts
  // dropping requests when hit hard.
  const details = [];
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < setList.length) {
      const s = setList[next++];
      try {
        details.push(await fetchJson(`${API}/sets/${s.id}`, { retries: 5, backoffMs: 400 }));
      } catch {
        // a set we cannot read just means those cards keep the image they have
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }));

  // Indexed three ways, and the date index refuses to answer when it cannot be sure.
  //
  // It used to be a plain Map, so the last set processed with a given release date won. Sets
  // ship together: "30th Celebration" (158 cards) and "30th Classic Collection" (30) were
  // both released 2026-09-16, so whichever arrived last became the answer for both. A wrong
  // set match is worse than none -- it attaches one set's printings to another's cards, and
  // the price mapping follows the printings.
  const byName = new Map();
  const byId = new Map();
  const datesSeen = new Map();
  for (const d of details) {
    byName.set(normName(d.name), d);
    byId.set(d.id, d);
    if (d.releaseDate) {
      if (!datesSeen.has(d.releaseDate)) datesSeen.set(d.releaseDate, []);
      datesSeen.get(d.releaseDate).push(d);
    }
  }
  const byDate = new Map();
  let ambiguousDates = 0;
  for (const [date, sets] of datesSeen) {
    if (sets.length === 1) byDate.set(date, sets[0]);
    else ambiguousDates++;
  }
  if (ambiguousDates) {
    console.log(`   ${ambiguousDates} release dates are shared by more than one set; those will not match by date`);
  }

  const cardUpdates = [];
  const variantRows = [];
  let imagesSet = 0;
  let setsMatched = 0;
  let done = 0;

  for (const ourSet of ourSets.values()) {
    const alias = SET_ALIASES[ourSet.id];
    const match = (alias && byId.get(alias))
      ?? byName.get(normName(ourSet.name))
      ?? byDate.get((ourSet.releaseDate ?? '').replace(/\//g, '-'));
    done++;
    onProgress?.({ synced: imagesSet, page: done, totalPages: ourSets.size });
    if (!match) continue;
    setsMatched++;

    const theirs = new Map();
    for (const c of match.cards ?? []) theirs.set(normNumber(c.localId), c);

    // Their cards indexed by name too, for the sets the two catalogues number differently.
    // Only names that are unique within the set are usable -- a set with two cards of the
    // same name cannot be matched this way without risking the wrong one.
    const byCardName = new Map();
    for (const c of match.cards ?? []) {
      const k = normCardName(c.name);
      byCardName.set(k, byCardName.has(k) ? null : c);   // null marks a duplicate
    }

    for (const ours of cardsBySet.get(ourSet.id) ?? []) {
      let theirCard = theirs.get(normNumber(ours.number));

      // Number first, then name. Celebrations: Classic Collection carries each card's
      // original number -- Donphan is 107 -- while TCGdex numbers the set CC001 to CC025, so
      // nothing matched and all 25 cards ended up with no printings. The name is only
      // trusted when exactly one card in the set has it.
      if (!theirCard) {
        const byName = byCardName.get(normCardName(ours.name));
        if (byName) theirCard = byName;
      }

      if (!theirCard) continue;
      // Guard against a number collision landing on a different card entirely.
      if (normCardName(theirCard.name) !== normCardName(ours.name)) continue;

      // Their id, which is what the printing data below is keyed on and what price capture
      // ultimately depends on. The artwork URL that used to be recorded beside it is gone:
      // card images are vendored onto the device and named from our own card id, so a
      // stored address was being shipped to the browser and discarded on arrival.
      //
      // The two were once the same fact -- the id was read back out of the image URL -- and
      // a card whose artwork went missing upstream silently withdrew from price capture as
      // a result. Keeping the id separate is what fixed that, and is why it survives the
      // URL being dropped.
      const webp = theirCard.image ? `${theirCard.image}/low.webp` : null;
      cardUpdates.push({ id: ours.id, tcgdex_id: theirCard.id });
      if (webp) imagesSet++;

      const printings = variantsById.get(theirCard.id);
      if (!printings) continue;
      // Position is the array index, kept because it is the only thing lining these labels up
      // with the pricing data's parallel array later.
      printings.forEach((v, position) => variantRows.push({
        card_id: ours.id,
        position,
        type: v.type ?? 'normal',
        subtype: v.subtype ?? null,
        stamp: v.stamp?.length ? v.stamp.join(',') : null,
        size: v.size ?? null,
        foil: v.foil ?? null,
      }));
    }
  }

  if (DRY_RUN) {
    console.log('');
    console.log('   DRY RUN -- nothing written');
    console.log(`   would set tcgdex_id on ${cardUpdates.length.toLocaleString()} cards`);
    console.log(`   would write ${variantRows.length.toLocaleString()} printings`);
    return {
      dryRun: true,
      synced: imagesSet,
      setsMatched,
      setsTotal: ourSets.size,
      imagesSet,
      variantRows: variantRows.length,
      cardsTotal: ourCards.length,
      proposed: variantRows,
      proposedCards: cardUpdates,
    };
  }

  // An upsert, not an insert: these cards already exist and only two columns change.
  await upsertAll('tcg_cards', cardUpdates, 'id');

  // Printings are upserted, then any a card no longer has are removed. Reconciling rather
  // than clearing matters more here than anywhere: these rows are what the entire price model
  // is keyed on, and price_map has a foreign key to them -- clearing them wholesale would
  // cascade away the mapping that took a day to build.
  await upsertAll('tcg_card_variants', variantRows, 'card_id,position');
  await reconcile('tcg_card_variants', 'card_id', 'position', variantRows);

  return {
    synced: imagesSet,
    setsMatched,
    setsTotal: ourSets.size,
    imagesSet,
    variantRows: variantRows.length,
    cardsTotal: ourCards.length,
  };
}
