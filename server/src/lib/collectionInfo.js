import { personalAll } from '../db/personalDb.js';

// Attaches each card's collection status (which boxes it's in, and total quantity owned
// across all of them) — shared by both the per-Pokémon card gallery and the standalone
// card browser, since both need the same "inBoxes / totalOwned" shape.
//
// Fetches the whole collection_entries table (bounded by how many cards the user has
// actually collected, not by how many cards are in this result set) rather than a
// per-card IN clause — a query with one bound parameter per row gets very slow once the
// page is large, e.g. the advanced search bar's "fetch everything" bulk request.
export function attachCollection(cards) {
  if (cards.length === 0) return cards;
  const cardIds = new Set(cards.map((c) => c.id));
  const rows = personalAll(
    `SELECT e.card_id as cardId, e.id as entryId, e.box_id as boxId, b.name as boxName, e.quantity
     FROM collection_entries e JOIN collection_boxes b ON b.id = e.box_id`,
  );
  const byCard = new Map();
  for (const row of rows) {
    if (!cardIds.has(row.cardId)) continue;
    if (!byCard.has(row.cardId)) byCard.set(row.cardId, []);
    byCard.get(row.cardId).push({
      entryId: row.entryId,
      boxId: row.boxId,
      boxName: row.boxName,
      quantity: row.quantity,
    });
  }
  return cards.map((c) => {
    const inBoxes = byCard.get(c.id) ?? [];
    return { ...c, inBoxes, totalOwned: inBoxes.reduce((sum, b) => sum + b.quantity, 0) };
  });
}
