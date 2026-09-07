import { all, run } from '../db/index.js';
import { fetchJson, sleep } from './http.js';

// TCGdex is a second, independent catalogue of the same English cards. We don't sync our
// card list from it (pokemon-tcg-data is more complete on the sets we carry — see the
// comment in tcgapi.js), but it has two things that dataset lacks:
//
//   - lightweight card images: ~19KB webp against the ~180KB png we'd otherwise load,
//     which is the single heaviest thing the card grid pulls
//   - which print variants each card exists in (normal / reverse / holo / 1st edition)
//
// So this runs as an enrichment pass over cards we already have, keyed by matching set +
// card number. Anything that doesn't match confidently is simply left alone.
const API = 'https://api.tcgdex.net/v2/en';
const GRAPHQL = 'https://api.tcgdex.net/v2/graphql';
const REQUEST_DELAY_MS = 30;
const CONCURRENCY = 4;

// Sets whose names differ enough between the two catalogues that normalising can't bridge
// them. Keyed by our set id.
const SET_ALIASES = { svp: 'svp' };

const normName = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
// "001" and "1" are the same card; keep any letter prefix (TG01, SV01) intact.
const normNumber = (s) => String(s ?? '').toUpperCase().replace(/^0+(?=\d)/, '');

// Only GraphQL exposes subtype/stamp/foil — the REST card endpoint returns the same array
// with prices but no labels, so this is where a printing gets its identity. Everything in
// one request (~3.8MB), rather than 23,000 individual card fetches.
async function fetchAllVariants() {
  const query = '{ cards { id variants_detailed { type subtype size stamp foil } } }';
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
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
 * Series wordmarks, matched to our series names. TCGdex serves an extension-less path; .webp
 * is the smallest of the formats it offers. Two of our series ("Other", "NP") are catch-all
 * buckets with no counterpart there and simply get none.
 */
async function syncSeriesLogos() {
  const ours = new Set(
    all("SELECT DISTINCT series FROM tcg_cards WHERE series IS NOT NULL AND series <> ''").map(
      (r) => r.series,
    ),
  );
  const res = await fetch(`${API}/series`);
  if (!res.ok) throw new Error(`TCGdex series returned ${res.status}`);

  let matched = 0;
  const byName = new Map((await res.json()).map((s) => [String(s.name).toLowerCase(), s]));
  for (const name of ours) {
    const hit = byName.get(name.toLowerCase());
    if (!hit?.logo) continue;
    run(
      `INSERT INTO tcg_series (name, logo_url) VALUES (@name, @logo)
       ON CONFLICT(name) DO UPDATE SET logo_url = excluded.logo_url`,
      { name, logo: `${hit.logo}.webp` },
    );
    matched++;
  }
  return matched;
}

export async function syncTcgdexEnrichment({ onProgress } = {}) {
  try {
    const matched = await syncSeriesLogos();
    console.log(`[tcgdex] series logos matched: ${matched}`);
  } catch (err) {
    // A missing wordmark is cosmetic; it must not fail the variant enrichment that follows.
    console.error(`[tcgdex] series logos unavailable: ${err.message}`);
  }

  const ourSets = all(
    'SELECT set_id as id, set_name as name, MIN(release_date) as releaseDate FROM tcg_cards GROUP BY set_id',
  );
  const ourCards = all('SELECT id, set_id as setId, number, name FROM tcg_cards');
  const cardsBySet = new Map();
  for (const c of ourCards) {
    if (!cardsBySet.has(c.setId)) cardsBySet.set(c.setId, []);
    cardsBySet.get(c.setId).push(c);
  }

  // One request for every card's variants, rather than ~20,000 individual card fetches.
  let variantsById = new Map();
  try {
    variantsById = await fetchAllVariants();
  } catch (err) {
    console.error(`TCGdex: variant lookup failed (${err.message}); images will still sync.`);
  }

  const setList = await fetchJson(`${API}/sets`, { retries: 5, backoffMs: 400 });
  const byName = new Map();
  const byDate = new Map();
  const byId = new Map();

  // Set details carry the card list; fetched with modest concurrency because this API
  // starts dropping requests when hit hard.
  const details = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < setList.length) {
        const s = setList[next++];
        try {
          details.push(await fetchJson(`${API}/sets/${s.id}`, { retries: 5, backoffMs: 400 }));
        } catch {
          // a set we can't read just means those cards keep their existing image
        }
        await sleep(REQUEST_DELAY_MS);
      }
    }),
  );
  for (const d of details) {
    byName.set(normName(d.name), d);
    byId.set(d.id, d);
    if (d.releaseDate) byDate.set(d.releaseDate, d);
  }

  let imagesSet = 0;
  let variantsSet = 0;
  let setsMatched = 0;
  let done = 0;

  for (const ourSet of ourSets) {
    const alias = SET_ALIASES[ourSet.id];
    const match =
      (alias && byId.get(alias)) ??
      byName.get(normName(ourSet.name)) ??
      byDate.get((ourSet.releaseDate ?? '').replace(/\//g, '-'));
    done++;
    onProgress?.({ synced: imagesSet, page: done, totalPages: ourSets.length });
    if (!match) continue;
    setsMatched++;

    const theirs = new Map();
    for (const c of match.cards ?? []) theirs.set(normNumber(c.localId), c);

    for (const ours of cardsBySet.get(ourSet.id) ?? []) {
      const theirCard = theirs.get(normNumber(ours.number));
      if (!theirCard) continue;
      // Guard against a number collision landing on a different card entirely.
      if (normName(theirCard.name) !== normName(ours.name)) continue;

      // TCGdex reports the image base itself, and reports null when it holds no artwork —
      // whole sets are like that, the Trainer Gallery subsets among them. Building the URL
      // from the set and number regardless stored a link that 404s, and because the card
      // query prefers image_webp over image_small, that dead link then hid a perfectly good
      // pokemontcg.io thumbnail. Cleared rather than left behind, so a card that loses its
      // artwork upstream falls back instead of staying broken.
      const webp = theirCard.image ? `${theirCard.image}/low.webp` : null;
      run('UPDATE tcg_cards SET image_webp = @webp WHERE id = @id', { webp, id: ours.id });
      if (webp) imagesSet++;

      const printings = variantsById.get(theirCard.id);
      if (!printings) continue;
      // Position is the array index, kept because it's the only way to line these labels
      // up with the pricing endpoint's parallel array later.
      run('DELETE FROM tcg_card_variants WHERE card_id = @id', { id: ours.id });
      printings.forEach((v, position) => {
        run(
          `INSERT OR IGNORE INTO tcg_card_variants (card_id, position, type, subtype, stamp, size, foil)
           VALUES (@id, @position, @type, @subtype, @stamp, @size, @foil)`,
          {
            id: ours.id,
            position,
            type: v.type ?? 'normal',
            subtype: v.subtype ?? null,
            stamp: v.stamp?.length ? v.stamp.join(',') : null,
            size: v.size ?? null,
            foil: v.foil ?? null,
          },
        );
        variantsSet++;
      });
    }
  }

  return {
    synced: imagesSet,
    setsMatched,
    setsTotal: ourSets.length,
    imagesSet,
    variantRows: variantsSet,
    cardsTotal: ourCards.length,
  };
}
