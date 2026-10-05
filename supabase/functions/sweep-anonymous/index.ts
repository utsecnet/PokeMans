/**
 * Deletes anonymous accounts that were never used for anything.
 *
 * Every visitor gets an anonymous account on arrival — that is what lets the catalogue be
 * readable without being public. Most never sign in, so each visit leaves a row in
 * auth.users that holds nothing and will never be used again. Left alone that grows
 * without limit.
 *
 * Only ever deletes an account that is all three of:
 *   anonymous   — a real account is never touched, whatever its age
 *   empty       — no collections and no want lists, so nothing is lost by deleting it
 *   stale       — last seen more than `olderThanDays` ago, so nobody mid-visit is swept
 *
 * The empty test is what makes a one-day cutoff safe rather than aggressive. Collecting
 * now needs a real account, so an anonymous session has nothing to lose by definition and
 * deleting one is indistinguishable from it never having existed — the next visit simply
 * issues another. Anything that does hold rows predates that rule and is excluded here
 * whatever its age, so it survives until its owner signs in and carries it across.
 *
 * Called by a schedule, or by an admin. Supports dryRun so it can be inspected first.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const DEFAULT_AGE_DAYS = 1;
/** A ceiling per run, so one invocation cannot spend its whole budget deleting. */
const MAX_DELETIONS = 500;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not authorised' }, 401);
  const token = authHeader.slice(7);

  // Two callers, two ways in. A schedule has no user and presents a service key; a person
  // presents their own access token and must be an admin.
  //
  // The service key is recognised by what it can do, not by matching it against the one in
  // the environment. Those are different strings for the same authority — a project issues
  // both a legacy JWT and a newer sb_secret_ key, either works, and comparing to whichever
  // happens to be injected rejects the other. Asking the admin API a trivial question
  // settles it without assuming a format.
  let authorised = false;
  {
    const asKey = createClient(SUPABASE_URL, token, { auth: { persistSession: false } });
    const { error } = await asKey.auth.admin.listUsers({ page: 1, perPage: 1 });
    authorised = !error;
  }
  if (!authorised) {
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: isAdmin } = await asCaller.rpc('is_admin');
    authorised = isAdmin === true;
  }
  if (!authorised) return json({ error: 'Admins only' }, 403);

  const body = await req.json().catch(() => ({}));
  const olderThanDays = Math.max(1, Number(body.olderThanDays) || DEFAULT_AGE_DAYS);
  const dryRun = body.dryRun === true;
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Every user id that owns anything. Read once rather than asked per account: a thousand
  // accounts would otherwise be a thousand round trips to answer the same question.
  const [{ data: boxes }, { data: lists }] = await Promise.all([
    db.from('collection_boxes').select('user_id'),
    db.from('want_lists').select('user_id'),
  ]);
  const holdsSomething = new Set([
    ...(boxes ?? []).map((r) => r.user_id),
    ...(lists ?? []).map((r) => r.user_id),
  ]);

  let page = 1;
  let scanned = 0;
  const doomed: string[] = [];
  // listUsers pages; walk until a short page or the ceiling is reached.
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return json({ error: error.message }, 500);
    const users = data.users;
    scanned += users.length;

    for (const u of users) {
      if (!u.is_anonymous) continue;
      if (holdsSomething.has(u.id)) continue;
      // last_sign_in_at is when the session was issued; created_at covers the case where
      // it is somehow absent. The later of the two is the last sign of life.
      const lastSeen = new Date(u.last_sign_in_at ?? u.created_at);
      if (lastSeen >= cutoff) continue;
      doomed.push(u.id);
      if (doomed.length >= MAX_DELETIONS) break;
    }

    if (doomed.length >= MAX_DELETIONS || users.length < 200) break;
    page++;
  }

  if (dryRun) {
    return json({ dryRun: true, scanned, wouldDelete: doomed.length, olderThanDays });
  }

  let deleted = 0;
  const failures: string[] = [];
  for (const id of doomed) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) failures.push(`${id}: ${error.message}`);
    else deleted++;
  }

  return json({
    scanned,
    deleted,
    failed: failures.length,
    olderThanDays,
    // Non-zero means the ceiling was hit and there is more to do; run it again.
    remaining: doomed.length >= MAX_DELETIONS ? 'at least some' : 0,
    ...(failures.length ? { errors: failures.slice(0, 5) } : {}),
  });
});
