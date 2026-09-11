import { Router } from 'express';
import { localCard, localiseCardLarge, localiseCards } from '../lib/artwork.js';
import { all as syncAll } from '../db/index.js';
import { personalAll, personalGet, personalRun } from '../db/personalDb.js';
import { capturePricesForCard, lastPriceSyncAt } from '../sync/prices.js';
import { printingsFor } from '../lib/cardPricing.js';

export const collectionRouter = Router();

const CONTAINER_TYPES = new Set(['box', 'deck', 'collection']);

function normalizeType(raw) {
  return CONTAINER_TYPES.has(raw) ? raw : 'box';
}

function getLastUsedBoxId() {
  const row = personalGet("SELECT value FROM settings WHERE key = 'last_used_box_id'");
  return row ? Number(row.value) : null;
}

function setLastUsedBoxId(boxId) {
  if (boxId === null) {
    personalRun("DELETE FROM settings WHERE key = 'last_used_box_id'");
    return;
  }
  personalRun(
    `INSERT INTO settings (key, value) VALUES ('last_used_box_id', @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    { value: String(boxId) },
  );
}


/**
 * One price per (card, printing), keyed `cardId:position`, from the most recent capture.
 *
 * Choosing a single row matters: PokemonPriceTracker records a separate row per condition —
 * Near Mint, Damaged, Heavily Played and so on — all under source 'tcgplayer'. Summing them
 * is how the collection list came to report several times a card's actual worth. Preference
 * is a row with no condition (a single market figure, which is what TCGdex writes), then
 * Near Mint, which is the condition a collection is normally quoted in.
 *
 * Priced only where a printing is recorded. A copy whose printing is unknown genuinely has
 * no price: a vintage card's prints differ several-fold, so choosing one on the owner's
 * behalf would invent a number rather than report one.
 */
export function latestPricesFor(entries) {
  const wanted = entries.filter((e) => e.variantPosition != null);
  if (wanted.length === 0) return new Map();

  const params = {};
  const pairs = wanted.map((e, i) => {
    params[`c${i}`] = e.cardId;
    params[`v${i}`] = e.variantPosition;
    return `(p.card_id = @c${i} AND p.variant_position = @v${i})`;
  });

  const rows = personalAll(
    `SELECT p.card_id AS cardId, p.variant_position AS variantPosition, p.condition,
            p.currency, p.market
       FROM card_price_history p
      WHERE p.source = 'tcgplayer' AND p.market IS NOT NULL AND (${pairs.join(' OR ')})
        AND p.captured_on = (
          SELECT MAX(p2.captured_on) FROM card_price_history p2
           WHERE p2.card_id = p.card_id AND p2.variant_position = p.variant_position
             AND p2.source = p.source AND p2.market IS NOT NULL
        )`,
    params,
  );

  const rank = (condition) => (condition == null ? 0 : condition === 'Near Mint' ? 1 : 2);
  const best = new Map();
  for (const row of rows) {
    const key = `${row.cardId}:${row.variantPosition}`;
    const held = best.get(key);
    if (!held || rank(row.condition) < rank(held.condition)) best.set(key, row);
  }
  return best;
}

/** How many cards a tile previews. Past four they are too small to recognise. */
const PREVIEW_CARDS = 4;

collectionRouter.get('/boxes', (_req, res) => {
  const boxes = personalAll(
    `SELECT b.id, b.name, b.type, b.color, b.icon, b.position, b.created_at as createdAt,
            COUNT(DISTINCT e.card_id) as cardCount,
            COUNT(e.id) as totalQuantity
     FROM collection_boxes b
     LEFT JOIN collection_entries e ON e.box_id = b.id
     GROUP BY b.id
     -- The user's own order first; anything never placed falls to the end in creation
     -- order rather than jumping to the front on a null.
     ORDER BY b.position IS NULL, b.position, b.created_at`,
  );

  // Valued in JS from the same helper the box view uses, rather than a second copy of the
  // rule in SQL. The two had drifted: this list was summing one row per condition and
  // reporting several times what a box was worth.
  const entries = personalAll(
    `SELECT box_id AS boxId, card_id AS cardId, variant_position AS variantPosition
       FROM collection_entries ORDER BY id`,
  );
  const prices = latestPricesFor(entries);
  const valueByBox = new Map();
  for (const entry of entries) {
    const price = prices.get(`${entry.cardId}:${entry.variantPosition}`)?.market;
    if (price == null) continue;
    valueByBox.set(entry.boxId, (valueByBox.get(entry.boxId) ?? 0) + price);
  }
  for (const box of boxes) {
    box.valueUsd = Math.round((valueByBox.get(box.id) ?? 0) * 100) / 100;
    // How many copies still need a printing chosen before they can be valued.
    box.unpriced = entries.filter(
      (e) => e.boxId === box.id && prices.get(`${e.cardId}:${e.variantPosition}`) == null,
    ).length;
  }
  // A few cards from each box, so a tile can show what is in it rather than an icon that
  // stands for it. Built from the entries already loaded above for the value sum — no extra
  // query — and capped, because a tile can only show a handful before they stop being legible.
  const previewByBox = new Map();
  for (const entry of entries) {
    const shown = previewByBox.get(entry.boxId) ?? [];
    if (shown.length >= PREVIEW_CARDS || shown.some((p) => p.cardId === entry.cardId)) continue;
    const url = localCard(entry.cardId);
    if (url) shown.push({ cardId: entry.cardId, url });
    previewByBox.set(entry.boxId, shown);
  }
  for (const box of boxes) {
    box.preview = (previewByBox.get(box.id) ?? []).map((p) => p.url);
  }

  res.json({
    boxes,
    lastUsedBoxId: getLastUsedBoxId(),
    pricesUpdatedAt: lastPriceSyncAt(),
  });
});

collectionRouter.post('/boxes', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const type = normalizeType(req.body?.type);
  const color = req.body?.color ? String(req.body.color) : null;
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const existing = personalGet('SELECT id FROM collection_boxes WHERE name = @name', { name });
  if (existing) {
    res.status(409).json({ error: 'A box with that name already exists' });
    return;
  }
  const result = personalRun(
    'INSERT INTO collection_boxes (name, type, color, created_at) VALUES (@name, @type, @color, @now)',
    { name, type, color, now: new Date().toISOString() },
  );
  const id = Number(result.lastInsertRowid);
  setLastUsedBoxId(id);
  res.json({
    id,
    name,
    type,
    color,
    createdAt: new Date().toISOString(),
    cardCount: 0,
    totalQuantity: 0,
  });
});

collectionRouter.patch('/boxes/:id', (req, res) => {
  const id = Number(req.params.id);
  const updates = [];
  const params = { id };

  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) {
      res.status(400).json({ error: 'name cannot be empty' });
      return;
    }
    const conflict = personalGet(
      'SELECT id FROM collection_boxes WHERE name = @name AND id != @id',
      { name, id },
    );
    if (conflict) {
      res.status(409).json({ error: 'A box with that name already exists' });
      return;
    }
    updates.push('name = @name');
    params.name = name;
  }

  if (req.body?.color !== undefined) {
    updates.push('color = @color');
    params.color = req.body.color ? String(req.body.color) : null;
  }

  if (req.body?.icon !== undefined) {
    const icon = req.body.icon ? String(req.body.icon) : null;
    // Shape-checked rather than matched against the drawn set: the client owns that list,
    // and an icon retired there should fall back to the default rather than make a rename
    // fail. Anything unknown renders as the Poke Ball.
    if (icon !== null && !/^[a-z0-9-]{1,32}$/.test(icon)) {
      res.status(400).json({ error: 'unrecognised icon' });
      return;
    }
    updates.push('icon = @icon');
    params.icon = icon === 'pokeball' ? null : icon;
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'name, color or icon is required' });
    return;
  }

  personalRun(`UPDATE collection_boxes SET ${updates.join(', ')} WHERE id = @id`, params);
  res.json({ ok: true });
});

/**
 * Sets the manual order from a list of ids, front to back.
 *
 * Takes the whole order rather than "move box 4 to slot 2" so the result can't drift from
 * what the user is looking at: the client sends the arrangement it just rendered, and any
 * collection it didn't mention keeps its place after the ones it did.
 */
collectionRouter.post('/boxes/reorder', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : null;
  if (!ids || ids.length === 0) {
    res.status(400).json({ error: 'ids must be a non-empty array' });
    return;
  }
  ids.forEach((id, index) => {
    personalRun('UPDATE collection_boxes SET position = @position WHERE id = @id', {
      position: index,
      id,
    });
  });
  // Anything not listed goes after everything that was, keeping its relative order.
  personalRun(
    `UPDATE collection_boxes SET position = @base + id
     WHERE id NOT IN (${ids.map((_, i) => `@id${i}`).join(', ')})`,
    { base: ids.length, ...Object.fromEntries(ids.map((id, i) => [`id${i}`, id])) },
  );
  res.json({ ok: true });
});

collectionRouter.delete('/boxes/:id', (req, res) => {
  const id = Number(req.params.id);
  personalRun('DELETE FROM collection_boxes WHERE id = @id', { id });
  if (getLastUsedBoxId() === id) setLastUsedBoxId(null);
  res.json({ ok: true });
});

collectionRouter.get('/boxes/:id', (req, res) => {
  const id = Number(req.params.id);
  const box = personalGet(
    'SELECT id, name, type, color, created_at as createdAt FROM collection_boxes WHERE id = @id',
    { id },
  );
  if (!box) {
    res.status(404).json({ error: 'Box not found' });
    return;
  }

  const rows = personalAll(
    `SELECT id, card_id as cardId, added_at as addedAt, variant_position as variantPosition
     FROM collection_entries WHERE box_id = @id ORDER BY added_at DESC, id DESC`,
    { id },
  );

  // Personal and sync data live in separate databases now, so this can't be a single SQL
  // JOIN — look up each entry's card details in the sync database and combine in JS. A
  // card_id with no match there (e.g. dropped by a resync) is skipped rather than shown
  // broken, since collection_entries has no FK into the sync database to prevent that.
  const cardsById = new Map(
    rows.length
      ? syncAll(
          `SELECT c.id, c.name, c.number, c.set_id as setId, c.set_name as setName, c.series, c.rarity,
                  COALESCE(c.image_webp, c.image_small) as imageSmall, c.image_large as imageLarge,
                  (SELECT p.id FROM tcg_card_pokemon tcp JOIN pokemon p ON p.id = tcp.pokemon_id
                   WHERE tcp.card_id = c.id LIMIT 1) as pokemonId,
                  (SELECT p.name FROM tcg_card_pokemon tcp JOIN pokemon p ON p.id = tcp.pokemon_id
                   WHERE tcp.card_id = c.id LIMIT 1) as pokemonName
           FROM tcg_cards c WHERE c.id IN (${rows.map((_, i) => `@id${i}`).join(', ')})`,
          Object.fromEntries(rows.map((r, i) => [`id${i}`, r.cardId])),
        ).map((c) => [c.id, c])
      : [],
  );

  const prices = latestPricesFor(rows);
  const entries = rows
    .map((row) => {
      const card = cardsById.get(row.cardId);
      if (!card) return null;
      // The card's printings travel with the entry so the UI can offer exactly the ones
      // this card was actually printed in, rather than a fixed list that might include a
      // reverse holo for a card that never had one.
      const printings = printingsFor(row.cardId);
      const chosen = printings.find((p) => p.position === row.variantPosition) ?? null;
      return {
        ...card,
        id: row.id,
        cardId: row.cardId,
        addedAt: row.addedAt,
        price: prices.get(`${row.cardId}:${row.variantPosition}`)?.market ?? null,
        priceCurrency: prices.get(`${row.cardId}:${row.variantPosition}`)?.currency ?? null,
        variantPosition: row.variantPosition ?? null,
        variantLabel: chosen?.label ?? null,
        printings,
      };
    })
    .filter((e) => e !== null);

  res.json({ ...box, entries: localiseCardLarge(localiseCards(entries)) });
});

// Quick-add: files `delta` more copies of this card (or removes that many when negative).
// Each copy is its own row, so adding the same card twice gives two rows that can later be
// told apart by printing. Also remembers this as the last-used box for future one-click
// adds. `variant` is optional and defaults to null ("printing not recorded"), which is what
// the one-tap flow sends — naming a printing is a separate, deliberate act.
collectionRouter.post('/entries', (req, res) => {
  const boxId = Number(req.body?.boxId);
  const cardId = String(req.body?.cardId ?? '');
  const delta = Number.isFinite(Number(req.body?.delta)) ? Number(req.body.delta) : 1;
  const variantPosition =
    req.body?.variantPosition === undefined || req.body?.variantPosition === null
      ? null
      : Number(req.body.variantPosition);

  if (!boxId || !cardId) {
    res.status(400).json({ error: 'boxId and cardId are required' });
    return;
  }
  const box = personalGet('SELECT id FROM collection_boxes WHERE id = @boxId', { boxId });
  if (!box) {
    res.status(404).json({ error: 'Box not found' });
    return;
  }

  // `IS` rather than `=` so an unrecorded printing (NULL) matches the unrecorded rows
  // instead of missing them — SQLite compares NULLs as distinct under `=`.
  const matching = () =>
    personalAll(
      `SELECT id FROM collection_entries
        WHERE box_id = @boxId AND card_id = @cardId AND variant_position IS @variantPosition
        ORDER BY id DESC`,
      { boxId, cardId, variantPosition },
    );

  let entry;
  if (delta < 0) {
    // Removing takes the most recently filed copies first, so an older copy that has had a
    // printing identified isn't the one discarded.
    const doomed = matching().slice(0, Math.abs(delta));
    for (const row of doomed) {
      personalRun('DELETE FROM collection_entries WHERE id = @id', { id: row.id });
    }
    const left = matching();
    entry = { id: left[0]?.id ?? null, quantity: left.length };
  } else {
    let lastId = null;
    for (let copy = 0; copy < Math.max(1, delta); copy++) {
      const result = personalRun(
        `INSERT INTO collection_entries (box_id, card_id, added_at, variant_position)
         VALUES (@boxId, @cardId, @now, @variantPosition)`,
        { boxId, cardId, now: new Date().toISOString(), variantPosition },
      );
      lastId = Number(result.lastInsertRowid);
    }
    entry = { id: lastId, quantity: matching().length };
  }

  setLastUsedBoxId(boxId);
  // Capture this card's prices now rather than leaving it blank until the next daily run.
  // Deliberately not awaited: filing a card should stay instant, and a pricing hiccup must
  // never fail the add. Skipped when the card already has rows for today.
  const alreadyPriced = personalGet(
    `SELECT 1 as found FROM card_price_history
     WHERE card_id = @cardId AND captured_on = @today LIMIT 1`,
    { cardId, today: new Date().toISOString().slice(0, 10) },
  );
  if (!alreadyPriced) {
    capturePricesForCard(cardId).catch((err) =>
      console.error(`Price capture for newly added ${cardId} failed: ${err.message}`),
    );
  }
  res.json({ ...entry, boxId, cardId, variantPosition });
});

// Records which printing a copy is. With one row per copy there is nothing to merge any
// more: two rows set to the same printing are two cards that happen to match, which is
// exactly what they were before anyone said so.
collectionRouter.patch('/entries/:id', (req, res) => {
  const id = Number(req.params.id);
  const body = req.body ?? {};

  // Moving a copy between collections. Cheap now that each copy is its own row: the row
  // keeps its identity, so the printing that was identified for it and when it was filed
  // travel with it, and there is nothing to merge or re-count at the destination.
  if ('boxId' in body) {
    const boxId = Number(body.boxId);
    if (!personalGet('SELECT id FROM collection_entries WHERE id = @id', { id })) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }
    if (!personalGet('SELECT id FROM collection_boxes WHERE id = @boxId', { boxId })) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }
    const from = personalGet('SELECT box_id AS boxId FROM collection_entries WHERE id = @id', { id });
    personalRun('UPDATE collection_entries SET box_id = @boxId WHERE id = @id', { boxId, id });
    res.json({ ok: true, boxId, movedFrom: from?.boxId ?? null });
    return;
  }

  if (!('variantPosition' in body)) {
    res.status(400).json({ error: 'variantPosition or boxId is required' });
    return;
  }
  const variantPosition =
    body.variantPosition === null || body.variantPosition === undefined
      ? null
      : Number(body.variantPosition);

  if (!personalGet('SELECT id FROM collection_entries WHERE id = @id', { id })) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  personalRun('UPDATE collection_entries SET variant_position = @variantPosition WHERE id = @id', {
    variantPosition,
    id,
  });
  res.json({ ok: true, variantPosition });
});

collectionRouter.delete('/entries/:id', (req, res) => {
  const id = Number(req.params.id);
  personalRun('DELETE FROM collection_entries WHERE id = @id', { id });
  res.json({ ok: true });
});
