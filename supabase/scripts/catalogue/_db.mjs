/**
 * The service-key connection the catalogue jobs write through, and the batching they need.
 *
 * These jobs used to write to a local SQLite file a row at a time, which is free when the
 * database is a file on the same disk. It is not free over a network: the old PokéAPI job
 * issued about five thousand single-row statements, and the card job one per card per type
 * per link. Sent one by one to Supabase that is tens of thousands of round trips for work
 * that fits in a few hundred requests, so everything here collects rows and writes them in
 * chunks.
 *
 * The service key bypasses row level security, which is the whole reason these can write to
 * tables no user may write to. It lives in supabase/.env, which git ignores, and must never
 * reach client/.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const readEnv = (file) => {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
};

const env = { ...readEnv('client/.env.local'), ...readEnv('supabase/.env') };

if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('   Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('   The first lives in client/.env.local, the second in supabase/.env.');
  process.exit(1);
}

export const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Postgres has a parameter ceiling, and a request that large is slow to retry when it fails. */
const CHUNK = 500;

/**
 * Upserts rows in chunks, returning how many were written.
 *
 * Empty input is not an error -- a set with no cards, a Pokémon with no abilities -- and
 * returning zero rather than making a request keeps the callers free of empty-array guards.
 */
export async function upsertAll(table, rows, onConflict) {
  if (!rows.length) return 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
}

/**
 * Every row of a table, paged.
 *
 * PostgREST caps a response at a thousand rows whatever the request asks for, so a plain
 * select of tcg_cards silently returns the first thousand of twenty thousand. That is the
 * kind of truncation that looks like working code.
 */
export async function selectAll(table, columns, shape = (q) => q) {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await shape(db.from(table).select(columns)).range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

/**
 * Removes the rows a re-sync no longer wants, and only those.
 *
 * The obvious way to make a child table match is to delete every row for the cards being
 * written and insert the new set. Against a local file that is one transaction; against a
 * network it is a hundred delete requests followed by a window in which every card has no
 * types at all, and a run that dies in that window leaves the catalogue visibly broken.
 *
 * So the rows that should exist are compared with the rows that do, and only the leftovers
 * are deleted -- a card that lost a printing upstream, which is a handful of rows on a
 * typical run and none at all on most. Grouped by card so each one costs a single request.
 */
export async function reconcile(table, cardColumn, keyColumn, desired) {
  const wanted = new Set(desired.map((r) => `${r[cardColumn]}|${r[keyColumn]}`));
  const touched = new Set(desired.map((r) => r[cardColumn]));

  const existing = await selectAll(table, `${cardColumn},${keyColumn}`);
  const orphansByCard = new Map();
  for (const row of existing) {
    // Only cards this run actually wrote: a card the run never saw keeps what it has.
    if (!touched.has(row[cardColumn])) continue;
    if (wanted.has(`${row[cardColumn]}|${row[keyColumn]}`)) continue;
    if (!orphansByCard.has(row[cardColumn])) orphansByCard.set(row[cardColumn], []);
    orphansByCard.get(row[cardColumn]).push(row[keyColumn]);
  }

  for (const [cardId, keys] of orphansByCard) {
    const { error } = await db.from(table).delete().eq(cardColumn, cardId).in(keyColumn, keys);
    if (error) throw new Error(`${table} delete: ${error.message}`);
  }
  return orphansByCard.size;
}


export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Deletes every row naming any of these cards, in chunks small enough for a URL.
 *
 * Unlike reconcile, this is a blunt clear, for the one case that wants one: a card matched to
 * a Pokémon by name rather than by dex number has no authoritative link, so whatever it has
 * is leftover from an older and less precise pass and should go before the new link lands.
 */
export async function deleteForCards(table, column, cardIds) {
  if (!cardIds.length) return;
  const ids = [...new Set(cardIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await db.from(table).delete().in(column, ids.slice(i, i + 200));
    if (error) throw new Error(`${table} delete: ${error.message}`);
  }
}
