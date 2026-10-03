/**
 * Does search_pokemon return what GET /api/pokemon returns?
 *
 * The server's SQLite queries are the specification. Every case runs both and compares
 * the total and the first page of ids, order included.
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
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(32)}${detail}`);
  ok ? pass++ : fail++;
};

const FROM = 'FROM pokemon p LEFT JOIN stats s ON s.pokemon_id = p.id';
const ORDER = 'ORDER BY p.national_dex_number ASC';
const BASE = 'p.is_default_variety = 1';

const CASES = [
  ['no filters', {}, BASE],
  ['search pika', { p_search: 'pika' }, `${BASE} AND LOWER(p.name) LIKE '%pika%'`],
  ['one generation', { p_generations: ['generation-i'] }, `${BASE} AND p.generation = 'generation-i'`],
  ['type any', { p_types: ['fire'] },
    `${BASE} AND p.id IN (SELECT pt.pokemon_id FROM pokemon_types pt JOIN types t ON t.id = pt.type_id WHERE t.name = 'fire')`],
  ['type all, two types', { p_types: ['fire', 'flying'], p_type_mode: 'all' },
    `${BASE} AND p.id IN (SELECT pt.pokemon_id FROM pokemon_types pt JOIN types t ON t.id = pt.type_id
       WHERE t.name IN ('fire','flying') GROUP BY pt.pokemon_id HAVING COUNT(DISTINCT t.name) = 2)`],
  ['type any, two types', { p_types: ['fire', 'flying'], p_type_mode: 'any' },
    `${BASE} AND p.id IN (SELECT pt.pokemon_id FROM pokemon_types pt JOIN types t ON t.id = pt.type_id
       WHERE t.name IN ('fire','flying'))`],
  ['ability', { p_abilities: ['levitate'] },
    `${BASE} AND p.id IN (SELECT pa.pokemon_id FROM pokemon_abilities pa JOIN abilities a ON a.id = pa.ability_id WHERE a.name = 'levitate')`],
  ['expansion', { p_expansions: ['base1'] },
    `${BASE} AND p.id IN (SELECT DISTINCT tcp.pokemon_id FROM tcg_card_pokemon tcp JOIN tcg_cards c ON c.id = tcp.card_id WHERE c.set_id = 'base1')`],
  ['hp range', { p_ranges: { hp: { min: 100, max: 255 } } }, `${BASE} AND s.hp >= 100 AND s.hp <= 255`],
  ['two ranges', { p_ranges: { hp: { min: 50, max: 100 }, speed: { min: 80, max: 200 } } },
    `${BASE} AND s.hp >= 50 AND s.hp <= 100 AND s.speed >= 80 AND s.speed <= 200`],
];

for (const [label, args, where] of CASES) {
  const want = db.prepare(`SELECT COUNT(*) n ${FROM} WHERE ${where}`).get().n;
  const wantIds = db.prepare(`SELECT p.id ${FROM} WHERE ${where} ${ORDER} LIMIT 10`).all().map((r) => r.id);

  const { data, error } = await sb.rpc('search_pokemon', { ...args, p_page: 1, p_page_size: 10 });
  if (error) { check(label, false, `${error.code ?? ''} ${error.message}`); continue; }

  const gotIds = data.items.map((r) => r.id);
  const ok = data.total === want && gotIds.length === wantIds.length && gotIds.every((v, i) => v === wantIds[i]);
  check(label, ok, ok ? `${want} species, first page matches` : `sqlite ${want} vs pg ${data.total}`);
}

{
  // Alternate forms must never appear: the dex is a list of species.
  const forms = db.prepare('SELECT COUNT(*) n FROM pokemon WHERE is_default_variety = 0').get().n;
  const { data } = await sb.rpc('search_pokemon', { p_page_size: 25000 });
  const dexTotal = db.prepare('SELECT COUNT(*) n FROM pokemon WHERE is_default_variety = 1').get().n;
  check('alternate forms excluded', data.total === dexTotal, `${data.total} shown, ${forms} forms hidden`);
}
{
  const { data, error } = await sb.rpc('search_pokemon', { p_sort: 'cardCount:desc', p_page_size: 3 });
  const counts = error ? [] : data.items.map((r) => r.cardCount);
  const descending = counts.length === 3 && counts.every((n, i) => i === 0 || n <= counts[i - 1]);
  check('sort by cardCount', descending, error?.message ?? `${counts.join(', ')} cards`);
}
{
  const { data } = await sb.rpc('search_pokemon', { p_search: 'pikachu', p_page_size: 1 });
  const row = data.items[0];
  const shape = ['id','nationalDexNumber','name','generation','spriteUrl','artworkUrl','height',
    'weight','baseExperience','hp','attack','defense','specialAttack','specialDefense','speed',
    'types','cardCount'];
  const missing = shape.filter((k) => !(k in row));
  check('row shape', missing.length === 0,
    missing.length ? `missing ${missing.join(', ')}` : `${row.name}: ${JSON.stringify(row.types)}, ${row.cardCount} cards`);
}

db.close();
console.log(`\n   ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
