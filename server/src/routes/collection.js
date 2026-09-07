import { Router } from 'express';
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
 * The latest TCGplayer market price for each (card, printing) pair in one query, keyed
 * `cardId:position`.
 *
 * Only priced when a printing is set. An entry whose printing is unknown genuinely has no
 * price: the printings of a vintage card can differ several-fold, so picking one on the
 * owner's behalf would invent a number rather than report one.
 */
function latestPricesFor(entries) {
  const wanted = entries.filter((e) => e.variantPosition != null);
  if (wanted.length === 0) return new Map();

  const params = {};
  const pairs = wanted.map((e, i) => {
    params[`c${i}`] = e.cardId;
    params[`v${i}`] = e.variantPosition;
    return `(p.card_id = @c${i} AND p.variant_position = @v${i})`;
  });

  const rows = personalAll(
    `SELECT p.card_id AS cardId, p.variant_position AS variantPosition, p.currency, p.market
       FROM card_price_history p
      WHERE p.source = 'tcgplayer' AND p.market IS NOT NULL AND (${pairs.join(' OR ')})
        AND p.captured_on = (
          SELECT MAX(p2.captured_on) FROM card_price_history p2
           WHERE p2.card_id = p.card_id AND p2.variant_position = p.variant_position
             AND p2.source = p.source AND p2.market IS NOT NULL
        )`,
    params,
  );
  return new Map(rows.map((r) => [`${r.cardId}:${r.variantPosition}`, r]));
}

collectionRouter.get('/boxes', (_req, res) => {
  const boxes = personalAll(
    `SELECT b.id, b.name, b.type, b.color, b.created_at as createdAt,
            COUNT(DISTINCT e.card_id) as cardCount,
            COUNT(e.id) as totalQuantity,
            -- Value from the most recent daily snapshot, in USD (TCGplayer is the only
            -- source quoted per finish, so mixing in Cardmarket's EUR would need a rate).
            -- A card with no snapshot yet simply contributes nothing rather than blocking
            -- the total, so this reads as "value of what we have prices for".
            COALESCE((
              SELECT SUM(p.market)
              FROM collection_entries e2
              JOIN card_price_history p ON p.card_id = e2.card_id
              WHERE e2.box_id = b.id
                AND p.source = 'tcgplayer'
                AND p.market IS NOT NULL
                -- Only copies whose printing is known. Falling back to another printing
                -- would report a number the owner never claimed; a vintage card's prints
                -- can differ several-fold.
                AND e2.variant_position IS NOT NULL
                AND p.variant_position = e2.variant_position
                AND p.captured_on = (
                  SELECT MAX(p2.captured_on) FROM card_price_history p2
                  WHERE p2.card_id = p.card_id AND p2.variant_position = p.variant_position
                    AND p2.source = p.source
                )
            ), 0) as valueUsd
     FROM collection_boxes b
     LEFT JOIN collection_entries e ON e.box_id = b.id
     GROUP BY b.id
     ORDER BY b.created_at`,
  );
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

  if (updates.length === 0) {
    res.status(400).json({ error: 'name or color is required' });
    return;
  }

  personalRun(`UPDATE collection_boxes SET ${updates.join(', ')} WHERE id = @id`, params);
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

  res.json({ ...box, entries });
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
  if (!('variantPosition' in (req.body ?? {}))) {
    res.status(400).json({ error: 'variantPosition is required' });
    return;
  }
  const variantPosition =
    req.body.variantPosition === null || req.body.variantPosition === undefined
      ? null
      : Number(req.body.variantPosition);

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
