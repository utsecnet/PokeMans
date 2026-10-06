/**
 * Does the deployed sync-prices function work, and refuse the people it should?
 *
 * Exercises the authorisation chain first — no token, then a signed-in non-admin — because
 * that is the part where a mistake hands the service role to anyone with an account. Then
 * makes a throwaway admin and runs a real capture against TCGdex.
 */
import { createClient } from '@supabase/supabase-js';
import { browsingSession, createTestUser } from './_helpers.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readEnv = (f) => Object.fromEntries(
  readFileSync(path.join(repo, f), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const env = { ...readEnv('client/.env.local'), ...readEnv('supabase/.env') };
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Needs SUPABASE_SERVICE_ROLE_KEY in supabase/.env to grant a test admin.');
  process.exit(1);
}
const FN = `${env.VITE_SUPABASE_URL}/functions/v1/sync-prices`;

// A real account, because the admin has to own cards for there to be anything to price —
// and since migration 0014 a browsing session cannot own any.
const owner = await createTestUser();
const user = owner.client;
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const session = { user: owner.user, session: owner.session };
const token = owner.session.access_token;

let pass = 0, fail = 0;
const check = (l, ok, d = '') => { console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(34)}${d}`); ok ? pass++ : fail++; };

// Who may ask for what. Naming cards is the card view wanting a price for the card it is
// showing; naming none is the whole daily capture. A service key can do either, because
// the schedule runs unattended and neither is_admin() nor is_real_account() can speak for
// something that has no user.
{
  const browsing = await browsingSession();
  const post = (token, body) => fetch(FN, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const cases = [
    ['a browsing session cannot price a card', await post(browsing.session.access_token, { cardIds: ['base1-4'] }), 403],
    ['a browsing session cannot run a capture', await post(browsing.session.access_token, {}), 403],
    ['a signed-in user can price one card', await post(owner.session.access_token, { cardIds: ['base1-4'] }), 200],
    ['a service key can price named cards', await post(env.SUPABASE_SERVICE_ROLE_KEY, { cardIds: ['base1-2'] }), 200],
    ['a service key can run the whole capture', await post(env.SUPABASE_SERVICE_ROLE_KEY, {}), 200],
  ];
  for (const [label, res, want] of cases) check(label, res.status === want, `HTTP ${res.status}`);
}

const noAuth = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
check('refuses a caller with no token', noAuth.status === 401, `HTTP ${noAuth.status}`);

const asUser = await fetch(FN, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
});
check('refuses a signed-in non-admin', asUser.status === 403, `HTTP ${asUser.status}`);

// Promote the throwaway account, and give it something worth pricing.
await admin.from('user_roles').insert({ user_id: session.user.id, role: 'admin' });
const { data: box } = await user.from('collection_boxes').insert({ name: 'Price test' }).select().single();
await user.from('collection_entries').insert([
  { box_id: box.id, card_id: 'base1-4' },
  { box_id: box.id, card_id: 'base1-2' },
  { box_id: box.id, card_id: 'base1-15' },
]);

// Clear today's prices for these three, so the run has work to do. Both tables, and the
// second one is the subtle half: `changed` counts rows appended to price_history, and
// that insert has `on conflict do nothing` on (card, printing, source, day). Clearing
// only price_current makes the capture run and record nothing -- correct behaviour, but
// it reads as a failure. The test reported exactly that until both were cleared.
const TEST_CARDS = ['base1-4', 'base1-2', 'base1-15'];
await admin.from('price_current').delete().in('card_id', TEST_CARDS);
await admin.from('price_history').delete().in('card_id', TEST_CARDS).eq('captured_on', new Date().toISOString().slice(0, 10));

const run = await fetch(FN, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ limit: 10 }),
});
const body = await run.json();
check('an admin can run it', run.status === 200, `HTTP ${run.status}`);
console.log('      ->', JSON.stringify(body));
check('it priced the owned cards', (body.priced ?? 0) > 0, `priced=${body.priced}`);
check('it wrote price rows', (body.changed ?? 0) > 0, `changed=${body.changed}`);

const { count } = await admin.from('price_current').select('*', { count: 'exact', head: true });
check('price_current has rows', (count ?? 0) > 0, `${count} rows`);

const { data: last } = await admin.from('sync_run')
  .select('status,cards_seen,prices_read,changed,failed').order('started_at', { ascending: false }).limit(1).single();
check('sync_run recorded the run', last?.status === 'success' || last?.status === 'partial', JSON.stringify(last));

// A second run the same day should find nothing to do: a price is a value for a day.
const again = await fetch(FN, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ limit: 10 }),
});
const body2 = await again.json();
check('a same-day re-run does no work', body2.priced === 0, JSON.stringify(body2.note ?? body2));

await admin.from('user_roles').delete().eq('user_id', session.user.id);
await owner.remove();

console.log(`\n   ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
