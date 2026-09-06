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

collectionRouter.get('/boxes', (_req, res) => {
  const boxes = personalAll(
    `SELECT b.id, b.name, b.type, b.color, b.created_at as createdAt,
            COUNT(DISTINCT e.card_id) as cardCount,
            COALESCE(SUM(e.quantity), 0) as totalQuantity,
            -- Value from the most recent daily snapshot, in USD (TCGplayer is the only
            -- source quoted per finish, so mixing in Cardmarket's EUR would need a rate).
            -- A card with no snapshot yet simply contributes nothing rather than blocking
            -- the total, so this reads as "value of what we have prices for".
            COALESCE((
              SELECT SUM(e2.quantity * p.market)
              FROM collection_entries e2
              JOIN card_price_history p ON p.card_id = e2.card_id
              WHERE e2.box_id = b.id
                AND p.source = 'tcgplayer'
                AND p.market IS NOT NULL
                AND p.variant_position = COALESCE(e2.variant_position, (
                  SELECT p3.variant_position FROM card_price_history p3
                  WHERE p3.card_id = e2.card_id AND p3.source = 'tcgplayer'
                  ORDER BY p3.market DESC LIMIT 1
                ))
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
    `SELECT id, card_id as cardId, quantity, added_at as addedAt, variant_position as variantPosition
     FROM collection_entries WHERE box_id = @id ORDER BY added_at DESC`,
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
        quantity: row.quantity,
        addedAt: row.addedAt,
        variantPosition: row.variantPosition ?? null,
        variantLabel: chosen?.label ?? null,
        printings,
      };
    })
    .filter((e) => e !== null);

  res.json({ ...box, entries });
});

// Quick-add: bumps quantity by `delta` (default 1) for this (box, card, variant) triple,
// creating the entry if needed. Also remembers this as the last-used box for future
// one-click adds. `variant` is optional and defaults to null ("printing not recorded"),
// which is what the one-tap flow sends — naming a printing is a separate, deliberate act.
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

  // `IS` rather than `=` so an unrecorded printing (NULL) matches the existing unrecorded
  // row instead of inserting a second one — SQLite's UNIQUE treats NULLs as distinct, so
  // this match is what actually keeps them collapsed.
  const existing = personalGet(
    `SELECT id, quantity FROM collection_entries
     WHERE box_id = @boxId AND card_id = @cardId AND variant_position IS @variantPosition`,
    { boxId, cardId, variantPosition },
  );

  let entry;
  if (existing) {
    const quantity = Math.max(1, existing.quantity + delta);
    personalRun('UPDATE collection_entries SET quantity = @quantity WHERE id = @id', {
      quantity,
      id: existing.id,
    });
    entry = { id: existing.id, quantity };
  } else {
    const result = personalRun(
      `INSERT INTO collection_entries (box_id, card_id, quantity, added_at, variant_position)
       VALUES (@boxId, @cardId, @quantity, @now, @variantPosition)`,
      { boxId, cardId, quantity: Math.max(1, delta), now: new Date().toISOString(), variantPosition },
    );
    entry = { id: Number(result.lastInsertRowid), quantity: Math.max(1, delta) };
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

collectionRouter.patch('/entries/:id', (req, res) => {
  const id = Number(req.params.id);

  // Recording which printing a copy is — sent on its own, without a quantity.
  if (req.body?.quantity === undefined && 'variantPosition' in (req.body ?? {})) {
    const variantPosition =
      req.body.variantPosition === null || req.body.variantPosition === undefined
        ? null
        : Number(req.body.variantPosition);
    const entry = personalGet(
      'SELECT box_id as boxId, card_id as cardId FROM collection_entries WHERE id = @id',
      { id },
    );
    if (!entry) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }
    // Naming a printing can collide with a row that already holds it; merge rather than
    // failing the UNIQUE, so setting two separate rows to "reverse" adds up.
    const clash = personalGet(
      `SELECT id, quantity FROM collection_entries
       WHERE box_id = @boxId AND card_id = @cardId AND variant_position IS @variantPosition AND id != @id`,
      { boxId: entry.boxId, cardId: entry.cardId, variantPosition, id },
    );
    if (clash) {
      const mine = personalGet('SELECT quantity FROM collection_entries WHERE id = @id', { id });
      personalRun('UPDATE collection_entries SET quantity = @quantity WHERE id = @clashId', {
        quantity: clash.quantity + (mine?.quantity ?? 0),
        clashId: clash.id,
      });
      personalRun('DELETE FROM collection_entries WHERE id = @id', { id });
      res.json({ ok: true, variantPosition, mergedInto: clash.id });
      return;
    }
    personalRun('UPDATE collection_entries SET variant_position = @variantPosition WHERE id = @id', {
      variantPosition,
      id,
    });
    res.json({ ok: true, variantPosition });
    return;
  }

  const quantity = Number(req.body?.quantity);
  if (!Number.isFinite(quantity)) {
    res.status(400).json({ error: 'quantity is required' });
    return;
  }
  if (quantity <= 0) {
    personalRun('DELETE FROM collection_entries WHERE id = @id', { id });
    res.json({ ok: true, deleted: true });
    return;
  }
  personalRun('UPDATE collection_entries SET quantity = @quantity WHERE id = @id', { quantity, id });
  res.json({ ok: true, quantity });
});

collectionRouter.delete('/entries/:id', (req, res) => {
  const id = Number(req.params.id);
  personalRun('DELETE FROM collection_entries WHERE id = @id', { id });
  res.json({ ok: true });
});
