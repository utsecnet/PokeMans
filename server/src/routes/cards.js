import { Router } from 'express';
import { all, get } from '../db/index.js';
import { personalAll } from '../db/personalDb.js';
import { attachCollection } from '../lib/collectionInfo.js';
import { fetchCardPricing, printingLabel, printingsFor, tcgdexIdFor } from '../lib/cardPricing.js';
import { convert, displayCurrency, ensureRates, rateTable } from '../lib/fx.js';
import { buildOrderByClause, parseSortChain } from '../lib/sortChain.js';
import { capturePricesIfStale } from '../sync/prices.js';

// Groups a per-card lookup table into {cardId -> [value]}. Reads only the rows for this
// page's cards — a normal page touches ~60, so a per-card IN clause is far cheaper than
// scanning the whole table.
function groupByCard(cards, sql, column) {
  const params = {};
  const keys = cards.map((c, i) => {
    params[`c${i}`] = c.id;
    return `@c${i}`;
  });
  const rows = all(sql.replace('@ids', keys.join(', ')), params);
  const byCard = new Map();
  for (const row of rows) {
    if (!byCard.has(row.cardId)) byCard.set(row.cardId, []);
    byCard.get(row.cardId).push(row[column]);
  }
  return byCard;
}

// Attaches the energy type(s) printed on each card, and which print variants it exists in.
function attachCardTypes(cards) {
  if (cards.length === 0) return cards;
  const types = groupByCard(
    cards,
    `SELECT card_id as cardId, type FROM tcg_card_types WHERE card_id IN (@ids) ORDER BY card_id, slot`,
    'type',
  );
  // Each printing, labelled — "Holo · Shadowless · 1st Edition" rather than just "holo".
  const printingRows = all(
    `SELECT card_id as cardId, position, type, subtype, stamp FROM tcg_card_variants
     WHERE card_id IN (${cards.map((_, i) => `@c${i}`).join(', ')}) ORDER BY card_id, position`,
    Object.fromEntries(cards.map((c, i) => [`c${i}`, c.id])),
  );
  const printings = new Map();
  for (const row of printingRows) {
    if (!printings.has(row.cardId)) printings.set(row.cardId, []);
    printings.get(row.cardId).push({
      position: row.position,
      type: row.type,
      subtype: row.subtype,
      stamp: row.stamp,
      label: printingLabel(row),
    });
  }
  return cards.map((c) => ({
    ...c,
    types: types.get(c.id) ?? [],
    variants: printings.get(c.id) ?? [],
  }));
}

export const cardsRouter = Router();

// Shared by the list and single-card endpoints so both return exactly the same shape — the
// card lightbox is opened from several places and reads the same fields whichever it is.
//
// The join is LEFT because Trainer and Energy cards link to no Pokémon at all; an inner
// join would silently drop every one of them. Resolving the Pokémon with a correlated MIN()
// (a card can list several, and we show the lowest-numbered) keeps `tcg_cards` as the
// driving table, so the sort index can be walked in order rather than sorting every
// matching row.
const CARD_COLUMNS = `c.id, c.name, c.number, c.set_id as setId, c.set_name as setName,
       c.series, c.rarity, c.release_date as releaseDate,
       -- Prefer the lighter TCGdex artwork, falling back to the original where the
       -- enrichment pass found no confident match.
       COALESCE(c.image_webp, c.image_small) as imageSmall, c.image_large as imageLarge,
       c.supertype, c.illustrator, pk.id as pokemonId, pk.name as pokemonName`;

const CARD_FROM = `FROM tcg_cards c
     LEFT JOIN pokemon pk ON pk.id = (SELECT MIN(tcp.pokemon_id) FROM tcg_card_pokemon tcp WHERE tcp.card_id = c.id)`;

const SORT_COLUMNS = {
  releaseDate: 'c.release_date',
  name: 'c.name',
  setName: 'c.set_name',
  number: 'CAST(c.number as INTEGER)',
  rarity: 'c.rarity',
  pokedexNumber: 'pk.national_dex_number',
  pokemonName: 'pk.name',
};

const DEFAULT_SORT_CHAIN = [{ field: 'releaseDate', dir: 'ASC' }];
const SORT_TIEBREAKERS = ['c.set_name ASC', 'CAST(c.number as INTEGER) ASC', 'c.id ASC'];

function csvParam(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function addInClause(where, params, expr, values, prefix) {
  if (values.length === 0) return;
  const keys = values.map((v, i) => `${prefix}${i}`);
  keys.forEach((k, i) => {
    params[k] = values[i];
  });
  where.push(`${expr} IN (${keys.map((k) => `@${k}`).join(', ')})`);
}

cardsRouter.get('/', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  // 25000 accommodates the "fetch everything, filter client-side" bulk request the
  // advanced search bar issues once a query uses operators it can't push down to SQL.
  const pageSize = Math.min(25000, Math.max(1, Number(req.query.pageSize) || 60));
  const offset = (page - 1) * pageSize;

  const search = req.query.search ? `%${String(req.query.search).toLowerCase()}%` : null;
  const expansions = csvParam(req.query.expansions);
  const series = csvParam(req.query.series);
  const rarities = csvParam(req.query.rarities);
  const types = csvParam(req.query.types);
  const generations = csvParam(req.query.generations);
  // "Pokémon", "Trainer", "Energy" — the only thing telling the latter two apart, since
  // neither links to a Pokémon at all.
  const supertypes = csvParam(req.query.supertypes);
  const illustrators = csvParam(req.query.illustrators);
  const owned = req.query.owned === 'true' ? true : req.query.owned === 'false' ? false : null;

  const sortChain = parseSortChain(req.query.sort, SORT_COLUMNS, DEFAULT_SORT_CHAIN);

  const where = [];
  const params = { limit: pageSize, offset };

  if (search) {
    where.push('(LOWER(c.name) LIKE @search OR LOWER(pk.name) LIKE @search)');
    params.search = search;
  }

  addInClause(where, params, 'c.set_id', expansions, 'expansion');
  addInClause(where, params, 'c.series', series, 'series');
  addInClause(where, params, 'c.rarity', rarities, 'rarity');
  addInClause(where, params, 'c.supertype', supertypes, 'supertype');
  addInClause(where, params, 'c.illustrator', illustrators, 'illustrator');

  if (types.length > 0) {
    const keys = types.map((_, i) => `type${i}`);
    keys.forEach((k, i) => {
      params[k] = types[i];
    });
    // Filters on the type printed on the card, not the linked Pokémon's types — on a card
    // browser those are different questions, and they disagree for most cards.
    where.push(
      `c.id IN (
         SELECT ct.card_id FROM tcg_card_types ct
         WHERE ct.type IN (${keys.map((k) => `@${k}`).join(', ')})
       )`,
    );
  }

  if (generations.length > 0) {
    const keys = generations.map((_, i) => `gen${i}`);
    keys.forEach((k, i) => {
      params[k] = generations[i];
    });
    where.push(
      `c.id IN (
         SELECT tcp.card_id FROM tcg_card_pokemon tcp
         JOIN pokemon p2 ON p2.id = tcp.pokemon_id
         WHERE p2.generation IN (${keys.map((k) => `@${k}`).join(', ')})
       )`,
    );
  }

  if (owned !== null) {
    // Personal and sync data live in separate databases now, so ownership can't be a
    // subquery against collection_entries from inside this query — fetch the owned card
    // IDs from the personal database first and filter on those instead.
    const ownedIds = personalAll('SELECT DISTINCT card_id as cardId FROM collection_entries').map(
      (r) => r.cardId,
    );
    if (ownedIds.length === 0) {
      if (owned) where.push('1 = 0'); // nothing is owned, so "owned:true" matches nothing
      // "owned:false" with nothing owned matches everything — no clause needed
    } else {
      const keys = ownedIds.map((_, i) => `owned${i}`);
      keys.forEach((k, i) => {
        params[k] = ownedIds[i];
      });
      where.push(`c.id ${owned ? 'IN' : 'NOT IN'} (${keys.map((k) => `@${k}`).join(', ')})`);
    }
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const primaryPokemonJoin = CARD_FROM;

  const items = all(
    `SELECT ${CARD_COLUMNS}
     ${primaryPokemonJoin}
     ${whereClause}
     ORDER BY ${buildOrderByClause(sortChain, SORT_COLUMNS, SORT_TIEBREAKERS)}
     LIMIT @limit OFFSET @offset`,
    params,
  );

  const { limit: _limit, offset: _offset, ...countParams } = params;
  // A LEFT JOIN never removes rows, so joining the Pokémon can only change the count when a
  // filter actually reads from it — and `search` is the only one that does. Dropping the
  // join otherwise is exactly equivalent and saves resolving the primary Pokémon for every
  // matching card, which is the single biggest cost left in a card page request.
  const countFrom = search ? primaryPokemonJoin : 'FROM tcg_cards c';
  const { total } = get(
    `SELECT COUNT(*) as total
     ${countFrom}
     ${whereClause}`,
    countParams,
  );

  const withTypes = attachCardTypes(items);

  res.json({ items: attachCollection(withTypes), total, page, pageSize });
});

// Market prices for one card, per print variant. Fetched live rather than read from the
// stored history: the panel should show what the card is worth right now, and it costs a
// single upstream request only when someone actually opens a card. Cached briefly so
// re-opening one is instant. The daily job in sync/prices.js is what builds up history.
const priceCache = new Map();
const PRICE_TTL_MS = 15 * 60 * 1000;

cardsRouter.get('/:id/pricing', async (req, res) => {
  const cardId = String(req.params.id);
  const exists = get('SELECT id FROM tcg_cards WHERE id = @id', { id: cardId });
  if (!exists) {
    res.status(404).json({ error: 'Card not found' });
    return;
  }
  const tcgdexId = tcgdexIdFor(cardId);
  if (!tcgdexId) {
    res.json({ cardId, variants: [], unavailable: 'No pricing source matched this card' });
    return;
  }

  const cached = priceCache.get(cardId);
  if (cached && Date.now() - cached.at < PRICE_TTL_MS) {
    res.json(cached.body);
    return;
  }

  try {
    const pricing = await fetchCardPricing(tcgdexId, cardId);
    const body = { cardId, ...pricing };
    priceCache.set(cardId, { at: Date.now(), body });
    res.json(body);
  } catch (err) {
    res.status(502).json({ error: `Could not reach the pricing source: ${err.message}` });
  }
});

// Captured daily for owned cards only, so this is empty for a card the user doesn't have.
//
// One chart per service; within it, one series per printing and marketplace (and condition,
// where the service reports one). Everything is converted to the user's display currency
// using the rate for each point's own date, so a service that quotes in two currencies no
// longer splits into two charts.
// Opening a card captures its current prices if today's are not already stored, so the panel
// has something to show for cards outside the collection too. Registered before '/:id' for the
// same reason every other sub-path is.
cardsRouter.post('/:id/prices/capture', async (req, res) => {
  const cardId = String(req.params.id);
  if (!get('SELECT id FROM tcg_cards WHERE id = @id', { id: cardId })) {
    res.status(404).json({ error: 'Card not found' });
    return;
  }
  try {
    res.json(await capturePricesIfStale(cardId));
  } catch (err) {
    res.status(502).json({ error: `Could not reach the pricing source: ${err.message}` });
  }
});

cardsRouter.get('/:id/price-history', async (req, res) => {
  const cardId = String(req.params.id);
  const rows = personalAll(
    `SELECT captured_on as capturedOn, variant_position as variantPosition, variant,
            service, source, condition, currency, market, low, volume
     FROM card_price_history WHERE card_id = @id
     ORDER BY captured_on ASC`,
    { id: cardId },
  );

  const currency = displayCurrency();
  try {
    await ensureRates(rows.map((r) => r.capturedOn));
  } catch (err) {
    // Without rates, values below stay in their own currency rather than failing the panel.
    console.error(`FX rates unavailable: ${err.message}`);
  }
  const table = rateTable();

  const labels = new Map(printingsFor(cardId).map((p) => [p.position, p.label]));
  const charts = new Map();
  let anyUnconverted = false;

  for (const row of rows) {
    if (typeof row.market !== 'number') continue;
    const value = convert(row.market, row.currency, currency, row.capturedOn, table);
    if (value == null) {
      anyUnconverted = true;
      continue;
    }

    if (!charts.has(row.service)) {
      charts.set(row.service, { service: row.service, currency, series: new Map() });
    }
    const chart = charts.get(row.service);
    const printing = labels.get(row.variantPosition) ?? row.variant;
    // Marketplace is part of the identity now that both share a chart — the same printing
    // priced by two marketplaces is two different quotes, not one series.
    const seriesKey = [printing, row.source, row.condition].filter(Boolean).join(' | ');
    if (!chart.series.has(seriesKey)) {
      chart.series.set(seriesKey, {
        label: row.condition ? `${printing} · ${row.condition}` : printing,
        printingLabel: printing,
        marketplace: row.source,
        variantPosition: row.variantPosition,
        condition: row.condition ?? null,
        points: [],
      });
    }
    chart.series.get(seriesKey).points.push({ date: row.capturedOn, market: value, volume: row.volume });
  }

  res.json({
    cardId,
    currency,
    ratesUnavailable: anyUnconverted,
    charts: [...charts.values()].map((c) => ({
      service: c.service,
      currency: c.currency,
      series: [...c.series.values()].sort((a, b) => a.label.localeCompare(b.label)),
    })),
  });
});

// The card browser's own type vocabulary (Colorless, Lightning, Darkness, Metal, ...),
// which is not the Pokémon type list served by /api/pokemon/meta/types.
cardsRouter.get('/meta/types', (_req, res) => {
  const rows = all('SELECT DISTINCT type FROM tcg_card_types ORDER BY type');
  res.json(rows.map((r) => r.type));
});

cardsRouter.get('/meta/rarities', (_req, res) => {
  const rows = all(
    'SELECT DISTINCT rarity FROM tcg_cards WHERE rarity IS NOT NULL ORDER BY rarity',
  );
  res.json(rows.map((r) => r.rarity));
});

cardsRouter.get('/meta/supertypes', (_req, res) => {
  res.json(
    all("SELECT DISTINCT supertype v FROM tcg_cards WHERE supertype IS NOT NULL AND supertype <> '' ORDER BY supertype")
      .map((r) => r.v),
  );
});

// Thousands of names, so this is the one option list worth searching rather than scrolling.
cardsRouter.get('/meta/illustrators', (_req, res) => {
  res.json(
    all("SELECT DISTINCT illustrator v FROM tcg_cards WHERE illustrator IS NOT NULL AND illustrator <> '' ORDER BY illustrator")
      .map((r) => r.v),
  );
});

cardsRouter.get('/meta/series', (_req, res) => {
  const rows = all(
    `SELECT series, MIN(release_date) as releaseDate
     FROM tcg_cards WHERE series IS NOT NULL
     GROUP BY series ORDER BY releaseDate`,
  );
  res.json(rows.map((r) => r.series));
});

// One card, in exactly the shape the list endpoint returns. This is what lets the card
// lightbox be opened from anywhere with nothing but an id — the Pokémon page's card
// gallery, a collection, or any surface added later — rather than each caller having to
// carry a full card object around.
//
// Declared last so the literal `/meta/...` paths above are matched first.
cardsRouter.get('/:id', (req, res) => {
  const rows = all(`SELECT ${CARD_COLUMNS} ${CARD_FROM} WHERE c.id = @id`, {
    id: String(req.params.id),
  });
  if (rows.length === 0) {
    res.status(404).json({ error: 'Card not found' });
    return;
  }
  const [card] = attachCollection(attachCardTypes(rows));
  res.json(card);
});
