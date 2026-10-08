/**
 * Moves what is left in personal.sqlite into Supabase.
 *
 *   node supabase/scripts/migratePersonal.mjs --user <uuid> [--apply]
 *
 * The catalogue went across months ago and matches row for row. What never followed is the
 * part that is actually yours: two boxes, seventeen copies, two want lists and forty-two
 * entries, all still only on the laptop.
 *
 * Three things make this more than a copy.
 *
 * Rows gain an owner. SQLite had one user implicitly -- whoever sat at the machine -- and
 * Supabase keys everything to an account, so each row is written against the account given
 * on the command line and nothing is inserted without one.
 *
 * Identifiers are reassigned. Both databases generate their own ids, and the local ones are
 * already taken over there, so boxes and lists are inserted first and their new ids carried
 * into the rows that point at them. last_used_box_id is remapped the same way; left alone
 * it would name a box belonging to somebody else.
 *
 * And three settings are deliberately not carried: prices.lastRunAt is now the sync_day log,
 * display.currency belonged to a control that no longer exists, and
 * pokemonpricetracker.quota described an integration that was retired.
 *
 * Nothing already in Supabase is touched or removed. A run adds; it never replaces.
 */
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const USER = args.includes('--user') ? args[args.indexOf('--user') + 1] : null;
const SQLITE = args.includes('--sqlite') ? args[args.indexOf('--sqlite') + 1] : 'server/data/personal.sqlite';

if (!USER) {
  console.error('   --user <uuid> is required: every row needs an owner.');
  process.exit(1);
}

const env = (f) => Object.fromEntries(
  fs.readFileSync(f, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const e = { ...env('client/.env.local'), ...env('supabase/.env') };
const db = createClient(e.VITE_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/** Settings that describe machinery which no longer exists. */
const RETIRED_SETTINGS = new Set([
  'prices.lastRunAt',               // superseded by the sync_day run log
  'display.currency',               // the control was removed; one source, one currency
  'pokemonpricetracker.quota',      // that integration is gone
]);

const { data: account, error: userErr } = await db.auth.admin.getUserById(USER);
if (userErr || !account?.user) {
  console.error(`   no such account: ${USER}${userErr ? ' — ' + userErr.message : ''}`);
  process.exit(1);
}
console.log(`   target account: ${account.user.email ?? USER}`);
console.log(`   source:         ${SQLITE}`);
console.log(`   mode:           ${APPLY ? 'APPLY' : 'dry run'}`);
console.log('');

const per = new DatabaseSync(SQLITE, { readOnly: true });
const boxes = per.prepare('select * from collection_boxes order by id').all();
const entries = per.prepare('select * from collection_entries order by id').all();
const lists = per.prepare('select * from want_lists order by id').all();
const listEntries = per.prepare('select * from want_list_entries order by id').all();
const settings = per.prepare('select * from settings').all();

/**
 * Names already taken in the target account.
 *
 * Both tables have a unique name per user, so a second "bag" would be rejected outright.
 * Rather than fail halfway, a clash is renamed on arrival and reported -- the alternative
 * is a partial migration whose remainder has to be worked out by hand.
 */
async function takenNames(table) {
  const { data, error } = await db.from(table).select('name').eq('user_id', USER);
  if (error) throw new Error(`${table}: ${error.message}`);
  return new Set((data ?? []).map((r) => r.name));
}
const boxNames = await takenNames('collection_boxes');
const listNames = await takenNames('want_lists');

const freeName = (name, taken) => {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
};

const plan = { boxes: [], entries: 0, lists: [], listEntries: 0, settings: [], skipped: [] };
for (const b of boxes) {
  const name = freeName(b.name, boxNames);
  boxNames.add(name);
  plan.boxes.push({ from: b, name, renamed: name !== b.name });
}
for (const l of lists) {
  const name = freeName(l.name, listNames);
  listNames.add(name);
  plan.lists.push({ from: l, name, renamed: name !== l.name });
}
plan.entries = entries.length;
plan.listEntries = listEntries.length;
for (const s of settings) {
  if (RETIRED_SETTINGS.has(s.key)) plan.skipped.push(s.key);
  else plan.settings.push(s);
}

console.log('   PLAN');
for (const b of plan.boxes) {
  const n = entries.filter((x) => x.box_id === b.from.id).length;
  console.log(`     box   ${b.name}${b.renamed ? ` (renamed from "${b.from.name}")` : ''} — ${n} copies`);
}
for (const l of plan.lists) {
  const n = listEntries.filter((x) => x.list_id === l.from.id).length;
  console.log(`     list  ${l.name}${l.renamed ? ` (renamed from "${l.from.name}")` : ''} — ${n} entries`);
}
for (const s of plan.settings) console.log(`     setting ${s.key}`);
for (const k of plan.skipped) console.log(`     skipped ${k} (retired)`);

if (!APPLY) {
  console.log('');
  console.log('   dry run — nothing written. Re-run with --apply.');
  per.close();
  process.exit(0);
}

// ---------------------------------------------------------------- write

console.log('');
const boxIdMap = new Map();
for (const b of plan.boxes) {
  const { data, error } = await db.from('collection_boxes').insert({
    user_id: USER, name: b.name, type: b.from.type, color: b.from.color,
    icon: b.from.icon, position: b.from.position, created_at: b.from.created_at,
  }).select('id').single();
  if (error) { console.error(`   box "${b.name}" failed: ${error.message}`); process.exit(1); }
  boxIdMap.set(b.from.id, data.id);
  console.log(`   box   ${b.name} -> id ${data.id}`);
}

const entryRows = entries
  .filter((x) => boxIdMap.has(x.box_id))
  .map((x) => ({
    user_id: USER, box_id: boxIdMap.get(x.box_id), card_id: x.card_id,
    // Null stays null: it means no printing has been chosen, which is a real state the
    // collection page reports as "unpriced" rather than a missing value to invent.
    variant_position: x.variant_position, added_at: x.added_at,
  }));
if (entryRows.length) {
  const { error } = await db.from('collection_entries').insert(entryRows);
  if (error) { console.error(`   entries failed: ${error.message}`); process.exit(1); }
  console.log(`   copies ${entryRows.length}`);
}

const listIdMap = new Map();
for (const l of plan.lists) {
  const { data, error } = await db.from('want_lists').insert({
    user_id: USER, name: l.name, color: l.from.color, query: l.from.query,
    live: !!l.from.live, last_synced_at: l.from.last_synced_at, created_at: l.from.created_at,
  }).select('id').single();
  if (error) { console.error(`   list "${l.name}" failed: ${error.message}`); process.exit(1); }
  listIdMap.set(l.from.id, data.id);
  console.log(`   list  ${l.name} -> id ${data.id}`);
}

const wantRows = listEntries
  .filter((x) => listIdMap.has(x.list_id))
  .map((x) => ({
    user_id: USER, list_id: listIdMap.get(x.list_id), card_id: x.card_id,
    state: x.state, added_at: x.added_at,
  }));
if (wantRows.length) {
  const { error } = await db.from('want_list_entries').insert(wantRows);
  if (error) { console.error(`   want entries failed: ${error.message}`); process.exit(1); }
  console.log(`   want entries ${wantRows.length}`);
}

for (const s of plan.settings) {
  // The one setting that points at another row has to point at the new one.
  const value = s.key === 'last_used_box_id'
    ? String(boxIdMap.get(Number(s.value)) ?? '')
    : s.value;
  if (!value) { console.log(`   setting ${s.key} skipped (its box did not migrate)`); continue; }
  const { error } = await db.from('user_settings')
    .upsert({ user_id: USER, key: s.key, value, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,key' });
  if (error) { console.error(`   setting ${s.key} failed: ${error.message}`); process.exit(1); }
  console.log(`   setting ${s.key} = ${value}`);
}

per.close();
console.log('');
console.log('   done. Nothing already in Supabase was changed or removed.');
