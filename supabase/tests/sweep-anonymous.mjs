/**
 * Does the sweep delete the right accounts, and refuse the wrong callers?
 *
 * Only dry runs here. A test that actually deleted would race the other suites, which
 * create anonymous accounts as they go — and this is the one function whose mistakes are
 * not recoverable.
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
const FN = `${env.VITE_SUPABASE_URL}/functions/v1/sweep-anonymous`;

const call = (body, token) => fetch(FN, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token ?? env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

let pass = 0, fail = 0;
const check = (l, ok, d = '') => { console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(42)}${d}`); ok ? pass++ : fail++; };

const svc = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const user = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const session = await user.auth.signInAnonymously();

const noToken = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
check('refuses a caller with no token', noToken.status === 401, `HTTP ${noToken.status}`);

const nonAdmin = await call({ dryRun: true }, session.data.session.access_token);
check('refuses a signed-in non-admin', nonAdmin.status === 403, `HTTP ${nonAdmin.status}`);

// A service key is recognised by capability, not by matching the injected string — a
// project has both a legacy JWT and an sb_secret_ key, and either must work.
const byKey = await call({ dryRun: true });
check('a service key is accepted', byKey.status === 200, JSON.stringify(byKey.body));

// The session created moments ago must never be eligible, whatever else is.
const fresh = await call({ dryRun: true, olderThanDays: 30 });
check('spares accounts younger than the cutoff', fresh.body.wouldDelete === 0, `wouldDelete=${fresh.body.wouldDelete}`);

const { data: all } = await svc.auth.admin.listUsers({ perPage: 1000 });
const anon = all.users.filter((u) => u.is_anonymous).length;
const real = all.users.filter((u) => !u.is_anonymous).length;

// An absurd cutoff: everything anonymous is stale. Still must not exceed the anonymous
// count, which is what proves real accounts are excluded by kind and not by age.
const everything = await call({ dryRun: true, olderThanDays: 1 });
check('never eligible: real accounts', everything.body.wouldDelete <= anon,
  `${everything.body.wouldDelete} candidates, ${anon} anonymous, ${real} real`);

// Accounts holding something are excluded too, so the candidate count must leave room for
// any anonymous account that owns a collection.
const { data: boxes } = await svc.from('collection_boxes').select('user_id');
const owners = new Set((boxes ?? []).map((r) => r.user_id));
const anonOwners = all.users.filter((u) => u.is_anonymous && owners.has(u.id)).length;
check('never eligible: accounts holding data', everything.body.wouldDelete <= anon - anonOwners,
  `${anonOwners} anonymous account(s) hold something`);

console.log(`\n   ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
