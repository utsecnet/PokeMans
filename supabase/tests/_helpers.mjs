/**
 * Shared fixtures for the Supabase suites.
 *
 * Collecting needs a real account since migration 0014, so tests that build collections
 * can no longer do it from an anonymous session — that is the rule they exist to protect.
 * createTestUser makes a throwaway confirmed account instead.
 *
 * The password is generated per call and never leaves this process. It exists because the
 * admin API needs one to create a signable account, not because anyone types it.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const readEnv = (f) => Object.fromEntries(
  readFileSync(path.join(repo, f), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

export const env = { ...readEnv('client/.env.local'), ...readEnv('supabase/.env') };

export const service = () =>
  createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export const anonClient = () =>
  createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

/** A signed-in anonymous session — a browsing visitor, who may read but not collect. */
export async function browsingSession() {
  const client = anonClient();
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw new Error(`anonymous sign-in failed: ${error.message}`);
  return { client, user: data.user, session: data.session };
}

/**
 * A real account, as if someone had signed up. Returns a client already signed in as them,
 * and a `remove` that deletes the account and everything it owns.
 */
export async function createTestUser() {
  const svc = service();
  const email = `test-${randomUUID()}@pokemans.invalid`;
  const password = randomUUID();
  const { data: created, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`could not create a test account: ${error.message}`);

  const client = anonClient();
  const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`could not sign in as the test account: ${signInError.message}`);

  return {
    client,
    user: created.user,
    session: signedIn.session,
    email,
    remove: () => svc.auth.admin.deleteUser(created.user.id),
  };
}

export function reporter() {
  let pass = 0, fail = 0;
  return {
    check(label, ok, detail = '') {
      console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(40)}${detail}`);
      ok ? pass++ : fail++;
    },
    finish() {
      console.log(`\n   ${pass} passed, ${fail} failed\n`);
      process.exit(fail === 0 ? 0 : 1);
    },
  };
}
