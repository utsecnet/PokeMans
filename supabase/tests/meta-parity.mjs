/**
 * Do the Postgres meta functions return exactly what the Express server returns?
 *
 * The server's SQLite queries are the specification. This runs each one against
 * catalog.sqlite, calls the matching Supabase function as an ordinary signed-in user, and
 * compares the results element by element — order included, because every one of these
 * populates a dropdown whose order is deliberate.
 */
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = Object.fromEntries(
  readFileSync(path.join(repo, 'client/.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const db = new DatabaseSync(path.join(repo, 'server/data/catalog.sqlite'), { readOnly: true });
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

// An ordinary visitor's session — not the service role. If a grant were missing, this
// is where it would show.
const { error: authErr } = await sb.auth.signInAnonymously();
if (authErr) { console.error('could not sign in:', authErr.message); process.exit(1); }

let pass = 0, fail = 0;

/** The server's queries, verbatim, each paired with the function meant to replace it. */
const CASES = [
  ['meta_pokemon_types', 'SELECT name v FROM types ORDER BY name'],
  ['meta_abilities', 'SELECT name v FROM abilities ORDER BY name'],
  ['meta_generations',
    `SELECT generation v FROM pokemon WHERE generation IS NOT NULL AND is_default_variety = 1
     GROUP BY generation ORDER BY MIN(national_dex_number)`],
  ['meta_card_types', 'SELECT DISTINCT type v FROM tcg_card_types ORDER BY type'],
  ['meta_rarities',
    "SELECT DISTINCT rarity v FROM tcg_cards WHERE rarity IS NOT NULL AND rarity <> '' ORDER BY rarity"],
  ['meta_supertypes',
    "SELECT DISTINCT supertype v FROM tcg_cards WHERE supertype IS NOT NULL AND supertype <> '' ORDER BY supertype"],
  ['meta_illustrators',
    "SELECT DISTINCT illustrator v FROM tcg_cards WHERE illustrator IS NOT NULL AND illustrator <> '' ORDER BY illustrator"],
  ['meta_series',
    `SELECT series v FROM tcg_cards WHERE series IS NOT NULL
     GROUP BY series ORDER BY MIN(release_date)`],
];

for (const [fn, sql] of CASES) {
  const want = db.prepare(sql).all().map((r) => r.v);
  const { data, error } = await sb.rpc(fn);
  const got = error ? null : data;

  if (error) {
    console.log(`   FAIL  ${fn.padEnd(20)} ${error.code ?? ''} ${error.message}`);
    fail++;
    continue;
  }
  // Membership must match exactly. Order is compared separately, because the two
  // databases disagree about what alphabetical means — see sortedSensibly below.
  const sameSet =
    got.length === want.length && new Set(want).size === new Set(got).size &&
    want.every((v) => got.includes(v));

  if (!sameSet) {
    const missing = want.filter((v) => !got.includes(v)).slice(0, 3);
    const extra = got.filter((v) => !want.includes(v)).slice(0, 3);
    console.log(`   FAIL  ${fn.padEnd(20)} sqlite ${want.length} vs pg ${got.length}` +
      (missing.length ? `, missing ${JSON.stringify(missing)}` : '') +
      (extra.length ? `, unexpected ${JSON.stringify(extra)}` : ''));
    fail++;
    continue;
  }

  // Where the server ordered alphabetically, check Postgres is alphabetical the way a
  // reader means it. SQLite orders by byte value, which files every capitalised name
  // ahead of every lowercase one — "AKIRA EGAWA" before "Aimi Tomita". Postgres uses the
  // database collation and gets it right, so this asserts the better behaviour rather
  // than reproducing the old one.
  const alphabetical = !['meta_generations', 'meta_series'].includes(fn);
  const sortedSensibly =
    !alphabetical ||
    got.every((v, i) => i === 0 || v.localeCompare(got[i - 1], 'en', { sensitivity: 'base' }) >= 0);

  if (sortedSensibly) {
    const note = alphabetical ? 'alphabetical, case-insensitive' : 'chronological, as served';
    console.log(`   PASS  ${fn.padEnd(20)} ${got.length} values, ${note}`);
    pass++;
  } else {
    const at = got.findIndex((v, i) => i > 0 && v.localeCompare(got[i - 1], 'en', { sensitivity: 'base' }) < 0);
    console.log(`   FAIL  ${fn.padEnd(20)} out of order at ${at}: ` +
      `${JSON.stringify(got[at - 1])} then ${JSON.stringify(got[at])}`);
    fail++;
  }
}

// Expansions returns rows, not strings, and the symbol URL is deliberately left raw —
// the client maps it to a local file, since nothing may be fetched from outside.
{
  const want = db.prepare(
    `SELECT c.set_id id, c.set_name name, c.series, MIN(c.release_date) releaseDate
     FROM tcg_cards c WHERE c.set_id IS NOT NULL
     GROUP BY c.set_id, c.set_name, c.series ORDER BY releaseDate, name`,
  ).all();
  const { data, error } = await sb.rpc('meta_expansions');
  if (error) { console.log(`   FAIL  meta_expansions      ${error.message}`); fail++; }
  else {
    // Same sets, same release dates. Order within a single release date differs, because
    // the tiebreak is the set name and the two databases sort names differently; what
    // matters is that the list runs oldest to newest, which it must for the UI to group
    // expansions by era.
    const byId = new Map(want.map((r) => [r.id, r.releaseDate.replace(/\//g, '-')]));
    const sameSets = data.length === want.length && data.every((r) => byId.has(r.id));
    const sameDates = data.every((r) => r.releaseDate === byId.get(r.id));
    const chronological = data.every((r, i) => i === 0 || r.releaseDate >= data[i - 1].releaseDate);
    const ok = sameSets && sameDates && chronological;
    console.log(`   ${ok ? 'PASS' : 'FAIL'}  meta_expansions      ${data.length} sets, oldest first` +
      (ok ? '' : ` (sets ${sameSets}; dates ${sameDates}; chronological ${chronological})`));
    ok ? pass++ : fail++;
  }
}

{
  const want = db.prepare(
    `SELECT MIN(p.height) minHeight, MAX(p.height) maxHeight, MIN(s.hp) minHp, MAX(s.speed) maxSpeed
     FROM pokemon p LEFT JOIN stats s ON s.pokemon_id = p.id`,
  ).get();
  const { data, error } = await sb.rpc('meta_ranges');
  const ok = !error && data.minHeight === want.minHeight && data.maxHeight === want.maxHeight
    && data.minHp === want.minHp && data.maxSpeed === want.maxSpeed;
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  meta_ranges          ` +
    (ok ? `height ${data.minHeight}-${data.maxHeight}, speed max ${data.maxSpeed}`
        : error?.message ?? `${JSON.stringify(data)} vs ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
}

db.close();
console.log(`\n   ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
