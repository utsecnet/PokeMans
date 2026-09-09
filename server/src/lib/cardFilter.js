import { personalAll } from '../db/personalDb.js';

/**
 * The joins the filter's clauses assume. `pk` is the card's primary Pokémon, resolved the
 * same way the cards route resolves it — a tag-team card links to several, and the lowest
 * id is the one its name is searched against. Kept here beside the WHERE builder because
 * the two only make sense together: `search` reads pk.name.
 */
export const CARD_FILTER_FROM = `FROM tcg_cards c
     LEFT JOIN pokemon pk ON pk.id = (SELECT MIN(tcp.pokemon_id) FROM tcg_card_pokemon tcp WHERE tcp.card_id = c.id)`;

/**
 * The Cards browser's filter, as a WHERE clause.
 *
 * Extracted from the cards route because want lists have to be able to answer "which cards
 * match this filter?" for a query saved months ago. Building that a second time would mean
 * two definitions of what `rarities=Rare Holo&owned=false` selects, and they would drift on
 * the first filter added to either — a live want list would then quietly hold a different
 * set of cards than the browser shows for the same query.
 *
 * Takes the parsed query-string object and returns fragments the caller assembles, rather
 * than running anything itself: the cards route needs them inside a large SELECT with joins
 * and paging, the want routes only need the ids.
 */
export function buildCardFilter(query) {
  const where = [];
  const params = {};

  const csv = (raw) =>
    !raw
      ? []
      : String(raw)
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);

  const addIn = (expr, values, prefix) => {
    if (values.length === 0) return;
    const keys = values.map((_, i) => `${prefix}${i}`);
    keys.forEach((k, i) => {
      params[k] = values[i];
    });
    where.push(`${expr} IN (${keys.map((k) => `@${k}`).join(', ')})`);
  };

  if (query.search) {
    params.search = `%${String(query.search).toLowerCase()}%`;
    where.push('(LOWER(c.name) LIKE @search OR LOWER(pk.name) LIKE @search)');
  }

  addIn('c.set_id', csv(query.expansions), 'expansion');
  addIn('c.series', csv(query.series), 'series');
  addIn('c.rarity', csv(query.rarities), 'rarity');
  addIn('c.supertype', csv(query.supertypes), 'supertype');
  addIn('c.illustrator', csv(query.illustrators), 'illustrator');

  const types = csv(query.types);
  if (types.length > 0) {
    const keys = types.map((_, i) => `type${i}`);
    keys.forEach((k, i) => {
      params[k] = types[i];
    });
    // The type printed on the card, not the linked Pokémon's types — on a card browser
    // those are different questions, and they disagree for most cards.
    where.push(
      `c.id IN (
         SELECT ct.card_id FROM tcg_card_types ct
         WHERE ct.type IN (${keys.map((k) => `@${k}`).join(', ')})
       )`,
    );
  }

  const generations = csv(query.generations);
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

  const owned = query.owned === 'true' ? true : query.owned === 'false' ? false : null;
  if (owned !== null) {
    // Personal and sync data live in separate database files, so ownership can't be a
    // subquery — read the owned ids first and filter on those.
    const ownedIds = personalAll('SELECT DISTINCT card_id as cardId FROM collection_entries').map(
      (r) => r.cardId,
    );
    if (ownedIds.length === 0) {
      // Nothing owned: "owned:true" matches nothing, "owned:false" matches everything.
      if (owned) where.push('1 = 0');
    } else {
      const keys = ownedIds.map((_, i) => `owned${i}`);
      keys.forEach((k, i) => {
        params[k] = ownedIds[i];
      });
      where.push(`c.id ${owned ? 'IN' : 'NOT IN'} (${keys.map((k) => `@${k}`).join(', ')})`);
    }
  }

  return { where, params, clause: where.length ? `WHERE ${where.join(' AND ')}` : '' };
}

/**
 * The card ids a saved filter currently selects. `query` is the stored query string.
 *
 * Deliberately unpaged: a want list is the whole result, not a page of it. The join matches
 * the browser's so a filter that mentions a Pokémon name selects the same cards here.
 */
export function cardIdsMatching(queryString, all) {
  const parsed = Object.fromEntries(new URLSearchParams(queryString ?? ''));
  const { clause, params } = buildCardFilter(parsed);
  return all(
    `SELECT DISTINCT c.id as id
     ${CARD_FILTER_FROM}
     ${clause}`,
    params,
  ).map((r) => r.id);
}
