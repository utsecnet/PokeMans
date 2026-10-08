/**
 * Exercises every read and write the app makes, as an ordinary signed-in account.
 *
 *   node supabase/scripts/regression.mjs
 *
 * The account is the point. A service-key read proves data exists and says nothing about
 * whether a user can reach it, and those two came apart more than once while this was being
 * built -- whole sets present in the database and absent on screen. Everything here goes
 * through row level security exactly as the browser does.
 *
 * It creates its own account, does its work, and deletes it, so a run leaves nothing behind
 * and cannot be affected by whatever the previous run did.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = (f) => Object.fromEntries(
  fs.readFileSync(f, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const e = { ...env('client/.env.local'), ...env('supabase/.env') };

const service = createClient(e.VITE_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const email = `regression-${Date.now()}@example.invalid`;
const password = `r${Math.random().toString(36).slice(2)}A1!`;
const { data: made, error: mkErr } =
  await service.auth.admin.createUser({ email, password, email_confirm: true });
if (mkErr) {
  console.error('   could not create the test account:', mkErr.message);
  process.exit(1);
}

const db = createClient(e.VITE_SUPABASE_URL, e.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { error: inErr } = await db.auth.signInWithPassword({ email, password });
if (inErr) {
  await service.auth.admin.deleteUser(made.user.id);
  console.error('   sign in failed:', inErr.message);
  process.exit(1);
}

let pass = 0;
const failures = [];

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(`   ok    ${name.padEnd(32)} ${String(Date.now() - started).padStart(5)}ms  ${detail ?? ''}`);
    pass++;
  } catch (err) {
    console.log(`   FAIL  ${name.padEnd(32)} ${err.message}`);
    failures.push(`${name}: ${err.message}`);
  }
}

async function rpc(fn, args) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

const cardArgs = (over = {}) => ({
  p_search: null, p_expansions: null, p_series: null, p_rarities: null, p_types: null,
  p_generations: null, p_supertypes: null, p_illustrators: null, p_owned: null,
  p_sort: null, p_page: 1, p_page_size: 60, ...over,
});

// ---------------------------------------------------------------- reads

await check('search_cards', async () => {
  const d = await rpc('search_cards', cardArgs());
  if (!d?.total) throw new Error('no total returned');
  // `items`, not `cards`. Reading the wrong key reported "0 of 20,635" and still passed,
  // because the check only looked at the total -- a test that cannot fail is not a test.
  if (!d.items?.length) throw new Error('a total with no rows');
  return `${d.items.length} of ${d.total.toLocaleString()}`;
});

await check('search_cards filtered', async () => {
  const d = await rpc('search_cards', cardArgs({ p_search: 'charizard', p_page_size: 20 }));
  if (!d?.total) throw new Error('no matches for a card that exists');
  if (!d.items?.length) throw new Error('a total with no rows');
  if (!d.items.every((c) => /charizard/i.test(c.name))) throw new Error('a result did not match the search');
  return `${d.total} matches`;
});

await check('search_pokemon', async () => {
  const d = await rpc('search_pokemon', {
    p_search: null, p_types: null, p_type_mode: 'any', p_generations: null, p_abilities: null,
    p_expansions: null, p_ranges: null, p_sort: null, p_page: 1, p_page_size: 60,
  });
  if (!d?.total) throw new Error('no total returned');
  if (!d.items?.length) throw new Error('a total with no rows');
  return `${d.items.length} of ${d.total.toLocaleString()}`;
});

await check('pokemon_detail', async () => {
  const d = await rpc('pokemon_detail', { p_id: 6 });
  if (!d) throw new Error('nothing returned');
  if (!d.evolutionChain) throw new Error('no evolution chain');
  if (d.evolutionChain.id !== 4) throw new Error(`chain rooted at ${d.evolutionChain.id}, expected charmander`);
  if (!d.tcgCards?.length) throw new Error('no cards');
  if (!d.stats) throw new Error('no stats');
  return `${d.name}, ${d.tcgCards.length} cards, chain from #${d.evolutionChain.id}`;
});

await check('card_price_history', async () => {
  const d = await rpc('card_price_history', { p_card_id: 'base1-4', p_days: 90 });
  const printings = d?.[0]?.printings ?? [];
  if (!printings.length) throw new Error('no printings');
  if (!printings[0].points?.length) throw new Error('no points');
  return `${printings.length} printings, ${printings[0].points.length} points, ${d[0].basis}`;
});

await check('card_first_priced', async () => String(await rpc('card_first_priced', { p_card_id: 'base1-4' })));
await check('collection_overview', async () => `${(await rpc('collection_overview')).boxes?.length ?? 0} boxes`);
await check('want_lists_overview', async () => { await rpc('want_lists_overview'); return 'ok'; });

for (const m of ['meta_pokemon_types', 'meta_generations', 'meta_abilities', 'meta_expansions',
                 'meta_series', 'meta_rarities', 'meta_illustrators', 'meta_supertypes', 'meta_card_types']) {
  await check(m, async () => `${(await rpc(m))?.length ?? 0} values`);
}

await check('price_health', async () => `${(await rpc('price_health')).pricedPrintings.toLocaleString()} priced`);
await check('set_coverage', async () => `${(await rpc('set_coverage')).length} sets`);
await check('database_usage', async () => `${(await rpc('database_usage')).pctUsed}% used`);
await check('sync_calendar', async () => `${(await rpc('sync_calendar', { p_days: 30 })).length} tracks`);
await check('app_today', async () => String(await rpc('app_today')));

// ---------------------------------------------------------------- writes

let boxId = null;
let listId = null;

await check('create a box', async () => {
  const { data, error } = await db.from('collection_boxes')
    .insert({ name: 'regression', type: 'box' }).select('id').single();
  if (error) throw new Error(error.message);
  boxId = data.id;
  return `id ${boxId}`;
});

await check('add a copy', async () => {
  const { error } = await db.from('collection_entries')
    .insert({ box_id: boxId, card_id: 'base1-4', variant_position: 0 });
  if (error) throw new Error(error.message);
  return 'base1-4';
});

await check('box shows the copy priced', async () => {
  const d = await rpc('collection_box', { p_box_id: boxId });
  if (!d?.entries?.length) throw new Error('the copy is missing');
  const first = d.entries[0];
  if (first.price == null) throw new Error('the copy has no price');
  return `${first.price} ${first.priceCurrency}`;
});

await check('create a want list', async () => {
  const { data, error } = await db.from('want_lists')
    .insert({ name: 'regression wants' }).select('id').single();
  if (error) throw new Error(error.message);
  listId = data.id;
  return `id ${listId}`;
});

await check('add a want', async () => {
  const { error } = await db.from('want_list_entries')
    .insert({ list_id: listId, card_id: 'base1-2', state: 'want' });
  if (error) throw new Error(error.message);
  return 'base1-2';
});

await check('settings round trip', async () => {
  const { error } = await db.from('user_settings')
    .upsert({ key: 'regression.probe', value: '1' }, { onConflict: 'user_id,key' });
  if (error) throw new Error(error.message);
  const { data } = await db.from('user_settings').select('value').eq('key', 'regression.probe').single();
  if (data?.value !== '1') throw new Error('did not read back');
  return 'read back';
});

// ---------------------------------------------------------------- the refusals

await check('is_admin is false', async () => {
  const v = await rpc('is_admin');
  if (v !== false) throw new Error(`an ordinary account got ${v}`);
  return 'false';
});

await check('cannot write prices', async () => {
  const { error } = await db.from('price_point')
    .insert({ card_ref: 1, variant_position: 0, source_id: 1, captured_on: '2020-01-01', market: 1 });
  if (!error) throw new Error('an ordinary account was allowed to write prices');
  return 'refused';
});

await check('cannot write the catalogue', async () => {
  const { error } = await db.from('tcg_cards').insert({ id: 'regression-fake', name: 'Nope' });
  if (!error) throw new Error('an ordinary account was allowed to write the catalogue');
  return 'refused';
});

await check('sees only its own rows', async () => {
  const { count } = await db.from('collection_entries').select('*', { count: 'exact', head: true });
  if (count !== 1) throw new Error(`saw ${count} copies, expected only its own`);
  return 'only its own';
});

await check('sync_day is admin only', async () => {
  const { data } = await db.from('sync_day').select('*').limit(1);
  if ((data ?? []).length) throw new Error('an ordinary account read the run log');
  return 'hidden';
});

// Deleting the account cascades its rows, so there is nothing else to clean up.
await service.auth.admin.deleteUser(made.user.id);

console.log('');
console.log(`   ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`     - ${f}`);
process.exit(failures.length ? 1 : 0);
