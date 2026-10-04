/**
 * Does signing in carry a browser session's work across, and refuse everything else?
 *
 * The refusals come first, because this function moves rows between two accounts and a
 * mistake in it is a way to steal a collection by naming its owner.
 */
import { createClient } from '@supabase/supabase-js';
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
const FN = `${env.VITE_SUPABASE_URL}/functions/v1/merge-anonymous`;

const newSession = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const svc = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (l, ok, d = '') => { console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(40)}${d}`); ok ? pass++ : fail++; };

// A stands in for the account someone already has; B for the browser they were browsing in.
const A = newSession(), B = newSession();
const a = await A.auth.signInAnonymously();
const b = await B.auth.signInAnonymously();

const { data: aBox } = await A.from('collection_boxes').insert({ name: 'Binder 1' }).select().single();
await A.from('collection_entries').insert({ box_id: aBox.id, card_id: 'base1-1' });

// Same name on both sides on purpose: names are unique per user, so the move has to
// resolve the clash before it can happen.
const { data: bBox } = await B.from('collection_boxes').insert({ name: 'Binder 1' }).select().single();
await B.from('collection_entries').insert([
  { box_id: bBox.id, card_id: 'base1-4' },
  { box_id: bBox.id, card_id: 'base1-2' },
]);
const { data: bList } = await B.from('want_lists').insert({ name: 'Chase' }).select().single();
await B.from('want_list_entries').insert({ list_id: bList.id, card_id: 'base1-15', state: 'want' });

const post = (token, body) => fetch(FN, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const noBody = await post(a.data.session.access_token, {});
check('refuses without the other session', noBody.status === 400, `HTTP ${noBody.status}`);

// Holding a user id is not holding a session: the token is checked with the auth server.
const forged = await post(a.data.session.access_token, { anonymousAccessToken: 'not-a-token' });
check('refuses a forged session token', forged.status === 401, `HTTP ${forged.status}`);

const merged = await post(a.data.session.access_token, { anonymousAccessToken: b.data.session.access_token });
const out = await merged.json();
check('merges B into A', merged.status === 200 && out.moved === true, JSON.stringify(out));

const { data: boxes } = await A.from('collection_boxes').select('name').order('name');
check('A now has both binders', boxes.length === 2, JSON.stringify(boxes.map((x) => x.name)));
check('the clashing name was disambiguated', boxes.some((x) => x.name.includes('(from this browser)')));

const { count: cards } = await A.from('collection_entries').select('*', { count: 'exact', head: true });
check("all 3 cards are A's now", cards === 3, `${cards} cards`);
const { count: wants } = await A.from('want_list_entries').select('*', { count: 'exact', head: true });
check('the want list came too', wants === 1, `${wants} wanted`);

const { data: users } = await svc.auth.admin.listUsers({ perPage: 200 });
check('the emptied account is gone', !users.users.some((u) => u.id === b.data.user.id));

// The safety property. Called with the service role, bypassing the Edge Function entirely,
// the SQL function must still refuse to empty an account that is not anonymous.
const C = newSession();
const c = await C.auth.signInAnonymously();
const real = users.users.find((u) => !u.is_anonymous);
if (real) {
  const { error: guard } = await svc.rpc('merge_anonymous_account', { p_from: real.id, p_to: c.data.user.id });
  check('refuses to merge FROM a real account', Boolean(guard), guard?.message ?? 'NO ERROR — BAD');
}

await svc.from('collection_boxes').delete().eq('user_id', a.data.user.id);
await svc.from('want_lists').delete().eq('user_id', a.data.user.id);

console.log(`\n   ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
