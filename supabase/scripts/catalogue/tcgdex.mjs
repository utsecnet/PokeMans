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

const API = 'https://api.tcgdex.net/v2/en';
const GRAPHQL = 'https://api.tcgdex.net/v2/graphql';
const REQUEST_DELAY_MS = 30;
const CONCURRENCY = 4;

// Sets whose names differ enough between the two catalogues that normalising cannot bridge
// them. Keyed by our set id.
const SET_ALIASES = { svp: 'svp' };

const normName = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
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

  const byName = new Map();
  const byDate = new Map();
  const byId = new Map();
  for (const d of details) {
    byName.set(normName(d.name), d);
    byId.set(d.id, d);
    if (d.releaseDate) byDate.set(d.releaseDate, d);
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

    for (const ours of cardsBySet.get(ourSet.id) ?? []) {
      const theirCard = theirs.get(normNumber(ours.number));
      if (!theirCard) continue;
      // Guard against a number collision landing on a different card entirely.
      if (normName(theirCard.name) !== normName(ours.name)) continue;

      // TCGdex reports the image base itself, and reports null when it holds no artwork --
      // whole sets are like that, the Trainer Gallery subsets among them. Building the URL
      // from set and number regardless stored a link that 404s, and because the card query
      // prefers image_webp over image_small, that dead link then hid a perfectly good
      // thumbnail. Cleared rather than left behind, so a card that loses its artwork upstream
      // falls back instead of staying broken.
      const webp = theirCard.image ? `${theirCard.image}/low.webp` : null;
      // Their id is recorded alongside, and separately from, the artwork. The two used to be
      // the same fact -- the id was read back out of the URL -- so clearing a dead image link
      // also silently withdrew the card from price capture.
      cardUpdates.push({ id: ours.id, image_webp: webp, tcgdex_id: theirCard.id });
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
