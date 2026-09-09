import { Router } from 'express';
import { all } from '../db/index.js';
import { personalAll, personalGet, personalRun } from '../db/personalDb.js';
import { cardIdsMatching } from '../lib/cardFilter.js';

export const wantsRouter = Router();

const nowIso = () => new Date().toISOString();

/**
 * Brings a live list up to date: anything the saved query now matches and that isn't
 * already on the list — or deliberately off it — is added.
 *
 * Only ever adds. A card the user took off the list carries an 'excluded' tombstone and the
 * UNIQUE (list_id, card_id) constraint makes INSERT OR IGNORE skip it, so removing something
 * from a live list makes it stay removed instead of reappearing on the next run.
 */
function refreshLiveList(list) {
  if (!list.live || !list.query) return 0;
  const matching = cardIdsMatching(list.query, all);
  const at = nowIso();
  let added = 0;
  for (const cardId of matching) {
    const result = personalRun(
      `INSERT OR IGNORE INTO want_list_entries (list_id, card_id, added_at, state)
       VALUES (@listId, @cardId, @at, 'want')`,
      { listId: list.id, cardId, at },
    );
    if (result.changes > 0) added++;
  }
  personalRun('UPDATE want_lists SET last_synced_at = @at WHERE id = @id', { at, id: list.id });
  return added;
}

function listRow(id) {
  return personalGet(
    `SELECT id, name, color, query, live, last_synced_at as lastSyncedAt, created_at as createdAt
     FROM want_lists WHERE id = @id`,
    { id },
  );
}

/**
 * Every want list with its counts. `owned` is how many of the wanted cards are in some
 * collection, which is what a progress figure needs — computed by intersecting against
 * collection_entries rather than stored, so acquiring a card updates every list holding it
 * without anything having to write to those lists.
 */
wantsRouter.get('/', (_req, res) => {
  const lists = personalAll(
    `SELECT id, name, color, query, live, last_synced_at as lastSyncedAt, created_at as createdAt
     FROM want_lists ORDER BY name`,
  );
  const counts = personalAll(
    `SELECT list_id as listId, COUNT(*) n FROM want_list_entries
     WHERE state = 'want' GROUP BY list_id`,
  );
  const owned = personalAll(
    `SELECT w.list_id as listId, COUNT(DISTINCT w.card_id) n
     FROM want_list_entries w
     WHERE w.state = 'want'
       AND w.card_id IN (SELECT card_id FROM collection_entries)
     GROUP BY w.list_id`,
  );
  const byId = (rows) => new Map(rows.map((r) => [r.listId, r.n]));
  const wanted = byId(counts);
  const have = byId(owned);

  res.json({
    lists: lists.map((l) => ({
      ...l,
      live: Boolean(l.live),
      wantedCount: wanted.get(l.id) ?? 0,
      ownedCount: have.get(l.id) ?? 0,
    })),
  });
});

wantsRouter.post('/', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const color = req.body?.color ?? null;
  const query = req.body?.query ? String(req.body.query) : null;
  const live = req.body?.live ? 1 : 0;

  // A live list with no query would silently never update; that is a caller bug, not a
  // state to store.
  if (live && !query) return res.status(400).json({ error: 'a live list needs a query' });

  let created;
  try {
    created = personalRun(
      `INSERT INTO want_lists (name, color, query, live, created_at)
       VALUES (@name, @color, @query, @live, @at)`,
      { name, color, query, live, at: nowIso() },
    );
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'a want list with that name already exists' });
    }
    throw err;
  }

  const id = Number(created.lastInsertRowid);

  // Seed from the query if one was given. This happens for snapshot lists too — the
  // difference between snapshot and live is only whether it is re-run later.
  let seeded = 0;
  if (query) {
    const at = nowIso();
    for (const cardId of cardIdsMatching(query, all)) {
      personalRun(
        `INSERT OR IGNORE INTO want_list_entries (list_id, card_id, added_at, state)
         VALUES (@listId, @cardId, @at, 'want')`,
        { listId: id, cardId, at },
      );
      seeded++;
    }
    personalRun('UPDATE want_lists SET last_synced_at = @at WHERE id = @id', { at, id });
  }

  res.status(201).json({ ...listRow(id), live: Boolean(live), seeded });
});

wantsRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = listRow(id);
  if (!existing) return res.status(404).json({ error: 'want list not found' });

  const fields = [];
  const params = { id };
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'name cannot be empty' });
    fields.push('name = @name');
    params.name = name;
  }
  if (req.body?.color !== undefined) {
    fields.push('color = @color');
    params.color = req.body.color ?? null;
  }
  if (req.body?.live !== undefined) {
    const live = req.body.live ? 1 : 0;
    if (live && !existing.query) {
      return res.status(400).json({ error: 'this list was not built from a filter, so it cannot follow one' });
    }
    fields.push('live = @live');
    params.live = live;
  }
  if (fields.length === 0) return res.status(400).json({ error: 'nothing to update' });

  personalRun(`UPDATE want_lists SET ${fields.join(', ')} WHERE id = @id`, params);

  // Turning live on catches the list up immediately, so the toggle has a visible effect
  // rather than waiting for whenever the list is next opened.
  const updated = listRow(id);
  const added = refreshLiveList(updated);
  res.json({ ...listRow(id), live: Boolean(updated.live), added });
});

wantsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  // Entries go with it via ON DELETE CASCADE.
  personalRun('DELETE FROM want_lists WHERE id = @id', { id });
  res.status(204).end();
});

/** Re-runs a live list's query on demand. */
wantsRouter.post('/:id/refresh', (req, res) => {
  const list = listRow(Number(req.params.id));
  if (!list) return res.status(404).json({ error: 'want list not found' });
  if (!list.live) return res.status(400).json({ error: 'this list does not follow a filter' });
  const added = refreshLiveList(list);
  res.json({ ...listRow(list.id), live: true, added });
});

/**
 * One want list and its cards, each carrying which collections hold it. A card in no
 * collection comes back with an empty inBoxes, which is what the client ghosts on.
 */
wantsRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const list = listRow(id);
  if (!list) return res.status(404).json({ error: 'want list not found' });

  // Opening a live list catches it up first, so what is shown is current.
  if (list.live) refreshLiveList(list);

  const wanted = personalAll(
    `SELECT card_id as cardId, added_at as addedAt FROM want_list_entries
     WHERE list_id = @id AND state = 'want' ORDER BY added_at, card_id`,
    { id },
  );
  if (wanted.length === 0) {
    return res.json({ ...listRow(id), live: Boolean(list.live), cards: [] });
  }

  const keys = wanted.map((_, i) => `@c${i}`);
  const params = {};
  wanted.forEach((w, i) => {
    params[`c${i}`] = w.cardId;
  });

  const cards = all(
    `SELECT c.id, c.name, c.number, c.set_id as setId, c.set_name as setName, c.series,
            c.rarity, c.supertype, c.illustrator, c.release_date as releaseDate,
            COALESCE(c.image_webp, c.image_small) as imageSmall, c.image_large as imageLarge,
            pk.id as pokemonId, pk.name as pokemonName
     FROM tcg_cards c
     LEFT JOIN pokemon pk ON pk.id = (SELECT MIN(tcp.pokemon_id) FROM tcg_card_pokemon tcp WHERE tcp.card_id = c.id)
     WHERE c.id IN (${keys.join(', ')})`,
    params,
  );

  // Which collections hold each wanted card. Read in one go rather than per card.
  const held = personalAll(
    `SELECT e.id as entryId, e.card_id as cardId, e.box_id as boxId, b.name as boxName
     FROM collection_entries e
     JOIN collection_boxes b ON b.id = e.box_id
     WHERE e.card_id IN (${keys.join(', ')})
     ORDER BY e.id`,
    params,
  );
  const boxesByCard = new Map();
  for (const row of held) {
    if (!boxesByCard.has(row.cardId)) boxesByCard.set(row.cardId, []);
    boxesByCard.get(row.cardId).push({
      entryId: row.entryId,
      boxId: row.boxId,
      boxName: row.boxName,
      quantity: 1,
    });
  }

  // Ordered by the want list, not by the catalogue, so the list reads in the order it grew.
  const byId = new Map(cards.map((c) => [c.id, c]));
  const ordered = wanted
    .map((w) => byId.get(w.cardId))
    // A card can vanish from the catalogue between a resync and now; skip rather than
    // render a hole, matching how collection entries handle the same case.
    .filter(Boolean)
    .map((c) => ({ ...c, inBoxes: boxesByCard.get(c.id) ?? [] }));

  res.json({
    ...listRow(id),
    live: Boolean(list.live),
    cards: ordered,
    ownedCount: ordered.filter((c) => c.inBoxes.length > 0).length,
  });
});

/** Adds one card to a list. Idempotent, and clears a previous exclusion. */
wantsRouter.post('/:id/cards', (req, res) => {
  const listId = Number(req.params.id);
  const cardId = String(req.body?.cardId ?? '').trim();
  if (!cardId) return res.status(400).json({ error: 'cardId is required' });
  if (!listRow(listId)) return res.status(404).json({ error: 'want list not found' });

  personalRun(
    `INSERT INTO want_list_entries (list_id, card_id, added_at, state)
     VALUES (@listId, @cardId, @at, 'want')
     ON CONFLICT (list_id, card_id) DO UPDATE SET state = 'want', added_at = @at`,
    { listId, cardId, at: nowIso() },
  );
  res.status(201).json({ listId, cardId });
});

/**
 * Takes a card off a list. On a list that follows a filter this leaves a tombstone so the
 * query can't put it straight back; on a hand-built list the row is simply dropped.
 */
wantsRouter.delete('/:id/cards/:cardId', (req, res) => {
  const listId = Number(req.params.id);
  const list = listRow(listId);
  if (!list) return res.status(404).json({ error: 'want list not found' });
  const { cardId } = req.params;

  if (list.live) {
    personalRun(
      `UPDATE want_list_entries SET state = 'excluded' WHERE list_id = @listId AND card_id = @cardId`,
      { listId, cardId },
    );
  } else {
    personalRun('DELETE FROM want_list_entries WHERE list_id = @listId AND card_id = @cardId', {
      listId,
      cardId,
    });
  }
  res.status(204).end();
});

/**
 * Which lists want a given card. Drives the want equivalent of the "in your collection"
 * badge without the Cards browser having to load every list's contents.
 */
wantsRouter.get('/meta/by-card', (_req, res) => {
  const rows = personalAll(
    `SELECT w.card_id as cardId, w.list_id as listId, l.name as listName
     FROM want_list_entries w JOIN want_lists l ON l.id = w.list_id
     WHERE w.state = 'want'`,
  );
  const byCard = {};
  for (const r of rows) {
    (byCard[r.cardId] ??= []).push({ listId: r.listId, listName: r.listName });
  }
  res.json({ byCard });
});
