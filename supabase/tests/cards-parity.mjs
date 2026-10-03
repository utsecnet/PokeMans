/**
 * Does search_cards return what GET /api/cards returns?
 *
 * The server's SQLite queries are the specification. Each case below runs the server's
 * filter against catalog.sqlite and the same filter through the Postgres function as an
 * ordinary signed-in user, then compares the total and the first page of ids.
 */
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = Object.fromEntries(
  readFileSync(path.join(repo, 'client/.env.local'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const db = new DatabaseSync(path.join(repo, 'server/data/catalog.sqlite'), { readOnly: true });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInAnonymously();
if (authErr) { console.error('sign-in failed:', authErr.message); process.exit(1); }

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)}${detail}`);
  ok ? pass++ : fail++;
};

/** The server's FROM clause and default ordering, so ids can be compared in sequence. */
const FROM = `FROM tcg_cards c
  LEFT JOIN pokemon pk ON pk.id = (SELECT MIN(tcp.pokemon_id) FROM tcg_card_pokemon tcp WHERE tcp.card_id = c.id)`;
const ORDER = `ORDER BY c.release_date ASC, c.set_name ASC, CAST(c.number AS INTEGER) ASC, c.id ASC`;

const CASES = [
  ['no filters', {}, '1 = 1'],
  ['search charizard', { p_search: 'charizard' },
    `(LOWER(c.name) LIKE '%charizard%' OR LOWER(pk.name) LIKE '%charizard%')`],
  ['one expansion', { p_expansions: ['base1'] }, `c.set_id = 'base1'`],
  ['two expansions', { p_expansions: ['base1', 'base2'] }, `c.set_id IN ('base1','base2')`],
  ['rarity', { p_rarities: ['Rare Holo'] }, `c.rarity = 'Rare Holo'`],
  ['supertype', { p_supertypes: ['Energy'] }, `c.supertype = 'Energy'`],
  ['card type', { p_types: ['Fire'] },
    `c.id IN (SELECT ct.card_id FROM tcg_card_types ct WHERE ct.type = 'Fire')`],
  ['generation', { p_generations: ['generation-i'] },
    `c.id IN (SELECT tcp.card_id FROM tcg_card_pokemon tcp JOIN pokemon p2 ON p2.id = tcp.pokemon_id
              WHERE p2.generation = 'generation-i')`],
  ['series', { p_series: ['Base'] }, `c.series = 'Base'`],
  ['two filters at once', { p_expansions: ['base1'], p_types: ['Fire'] },
    `c.set_id = 'base1' AND c.id IN (SELECT ct.card_id FROM tcg_card_types ct WHERE ct.type = 'Fire')`],
];

for (const [label, args, where] of CASES) {
  const want = db.prepare(`SELECT COUNT(*) n ${FROM} WHERE ${where}`).get().n;
  const wantIds = db.prepare(`SELECT c.id ${FROM} WHERE ${where} ${ORDER} LIMIT 10`).all().map((r) => r.id);

  const { data, error } = await sb.rpc('search_cards', { ...args, p_page: 1, p_page_size: 10 });
  if (error) { check(label, false, `${error.code ?? ''} ${error.message}`); continue; }

  const gotIds = data.items.map((r) => r.id);
  const sameTotal = data.total === want;
  const sameIds = gotIds.length === wantIds.length && gotIds.every((v, i) => v === wantIds[i]);
  check(label, sameTotal && sameIds,
    sameTotal ? `${want} cards, first page matches` : `sqlite ${want} vs pg ${data.total}`);
}

// Sorting, and the hazard the port had to solve. The server casts the printed number to an
// integer; SQLite turns 'SV001' into 0, Postgres would reject it outright.
{
  const { data, error } = await sb.rpc('search_cards', { p_sort: 'name:desc', p_page_size: 3 });
  const names = error ? [] : data.items.map((r) => r.name);
  const descending = names.length === 3 && names.every((n, i) => i === 0 || n.localeCompare(names[i - 1]) <= 0);
  check('sort by name, descending', descending, error?.message ?? names.join(' | '));
}
{
  const nonNumeric = db.prepare(
    `SELECT COUNT(*) n FROM tcg_cards WHERE number GLOB '*[^0-9]*'`).get().n;
  const { data, error } = await sb.rpc('search_cards', { p_sort: 'number:asc', p_page_size: 5 });
  check('sort by number survives non-numeric', !error && data.items.length === 5,
    error?.message ?? `${nonNumeric} cards have a non-numeric number`);
}
{
  // The field a caller cannot inject through: an unknown sort key is dropped, not passed on.
  const { data, error } = await sb.rpc('search_cards', { p_sort: 'name; drop table tcg_cards:asc', p_page_size: 1 });
  check('unknown sort key is ignored', !error && data.items.length === 1,
    error?.message ?? 'fell back to the default order');
}
{
  const total = db.prepare('SELECT COUNT(*) n FROM tcg_cards').get().n;
  const { data } = await sb.rpc('search_cards', { p_page: 2, p_page_size: 60 });
  const wantIds = db.prepare(`SELECT c.id ${FROM} ${ORDER} LIMIT 60 OFFSET 60`).all().map((r) => r.id);
  const gotIds = data.items.map((r) => r.id);
  check('page 2 matches', data.total === total && gotIds.every((v, i) => v === wantIds[i]),
    `${data.items.length} items, total ${data.total}`);
}
{
  const { data } = await sb.rpc('search_cards', { p_search: 'charizard', p_page_size: 1 });
  const row = data.items[0];
  const shape = ['id','name','number','setId','setName','series','rarity','releaseDate',
    'imageSmall','imageLarge','supertype','illustrator','seriesLogoUrl','setSymbolUrl',
    'setLogoUrl','pokemonId','pokemonName','types','owned'];
  const missing = shape.filter((k) => !(k in row));
  check('row shape matches CardListItem', missing.length === 0,
    missing.length ? `missing ${missing.join(', ')}` : `${shape.length} fields, types=${JSON.stringify(row.types)}`);
}

db.close();
console.log(`\n   ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
