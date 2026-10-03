/**
 * Does row level security actually hold?
 *
* Creates two anonymous accounts and checks that neither can reach the
 * other's rows, that a signed-out caller can reach nothing at all, and that the shared
 * catalogue is readable once signed in. Deletes its own rows at the end.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../client/.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

// ---------------------------------------------------------------- signed out
const out = createClient(URL_, KEY, opts);
{
  const cards = await out.from('tcg_cards').select('id').limit(1);
  check('signed out cannot read the catalogue', cards.error !== null || cards.data?.length === 0,
    cards.error ? cards.error.code : `${cards.data?.length} rows`);

  const boxes = await out.from('collection_boxes').select('id').limit(1);
  check('signed out cannot read collections', boxes.error !== null || boxes.data?.length === 0,
    boxes.error ? boxes.error.code : `${boxes.data?.length} rows`);

  const roles = await out.from('user_roles').select('user_id').limit(1);
  check('signed out cannot read user_roles', roles.error !== null || roles.data?.length === 0,
    roles.error ? roles.error.code : `${roles.data?.length} rows`);
}

// ---------------------------------------------------------------- user A
const A = createClient(URL_, KEY, opts);
const a = await A.auth.signInAnonymously();
if (a.error) { console.error('could not create user A:', a.error.message); process.exit(1); }
const aId = a.data.user.id;
console.log(`\n   user A = ${aId.slice(0, 8)}…  (anonymous: ${a.data.user.is_anonymous})\n`);

const made = await A.from('collection_boxes').insert({ name: 'RLS probe A' }).select().single();
check('A can create a collection', !made.error, made.error?.message ?? `box ${made.data?.id}`);
const boxId = made.data?.id;

{
  const mine = await A.from('collection_boxes').select('id,name,user_id');
  check('A can read it back', mine.data?.length === 1, `${mine.data?.length} rows`);
  check('the row is stamped with A', mine.data?.[0]?.user_id === aId);

  const cat = await A.from('tcg_cards').select('id').limit(1);
  check('A can read the shared catalogue', !cat.error, cat.error?.message ?? 'reachable (table empty)');

  const roles = await A.from('user_roles').select('user_id').limit(1);
  check('A cannot read user_roles', roles.error !== null || roles.data?.length === 0,
    roles.error ? roles.error.code : `${roles.data?.length} rows`);

  const admin = await A.rpc('is_admin');
  check('A is not admin', admin.data === false, `is_admin() = ${admin.data}`);
}

// ---------------------------------------------------------------- user B
const B = createClient(URL_, KEY, opts);
const b = await B.auth.signInAnonymously();
if (b.error) { console.error('could not create user B:', b.error.message); process.exit(1); }
console.log(`\n   user B = ${b.data.user.id.slice(0, 8)}…\n`);

{
  const all = await B.from('collection_boxes').select('id,name');
  check("B sees none of A's collections", all.data?.length === 0, `${all.data?.length} rows`);

  const direct = await B.from('collection_boxes').select('id,name').eq('id', boxId);
  check("B cannot fetch A's box by its id", direct.data?.length === 0, `${direct.data?.length} rows`);

  const steal = await B.from('collection_boxes').update({ name: 'stolen' }).eq('id', boxId).select();
  check("B cannot rename A's box", steal.error !== null || steal.data?.length === 0,
    steal.error ? steal.error.code : `${steal.data?.length} rows changed`);

  const wipe = await B.from('collection_boxes').delete().eq('id', boxId).select();
  check("B cannot delete A's box", wipe.error !== null || wipe.data?.length === 0,
    wipe.error ? wipe.error.code : `${wipe.data?.length} rows deleted`);

  // The composite foreign key should make this impossible even if a policy were wrong.
  const plant = await B.from('collection_entries').insert({ box_id: boxId, card_id: 'base1-4' }).select();
  check("B cannot file a card into A's box", plant.error !== null,
    plant.error ? plant.error.code : 'INSERT SUCCEEDED');

  const forge = await B.from('collection_boxes').insert({ name: 'forged', user_id: aId }).select();
  check('B cannot create a row owned by A', forge.error !== null,
    forge.error ? forge.error.code : 'INSERT SUCCEEDED');
}

// ---------------------------------------------------------------- still there?
{
  const after = await A.from('collection_boxes').select('id,name').eq('id', boxId);
  check("A's box survived all that, unrenamed", after.data?.[0]?.name === 'RLS probe A',
    after.data?.[0]?.name ?? 'gone');
}

// ---------------------------------------------------------------- clean up
const gone = await A.from('collection_boxes').delete().eq('id', boxId).select();
check('A can delete their own box', gone.data?.length === 1, `${gone.data?.length} rows`);

console.log(`\n   ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
