/**
 * Applies the retention bands to stored price history.
 *
 *     0-7 days    every day
 *     8-30 days   Mondays and Thursdays
 *     31+ days    Mondays
 *
 * All the thinking lives in the thin_price_history function, which is also where those
 * bands are defined -- this is only the door the schedule knocks on, and it deliberately
 * knows nothing about the policy beyond reporting what the function says it did.
 *
 * The work is a handful of deletes over indexed ranges. It runs with a raised statement
 * timeout because the history is now millions of rows, but still finishes well inside the
 * time an Edge Function is given.
 *
 * Deploy:
 *   npx supabase functions deploy thin-price-history --project-ref xamyixuipbkyzssvxchc
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SOURCE_ID = 1;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/**
 * Whether this caller may set off a scheduled job: an admin, or the schedule itself.
 *
 * The schedule presents the service key, which authenticates as service_role -- a role with
 * no auth.uid(), so is_admin() quite correctly says no for it. Checking only is_admin()
 * therefore locks out the very caller the job exists for, and does it at 07:00 where nobody
 * is watching rather than in a test.
 *
 * The service key is recognised by capability, not by comparing strings: a comparison would
 * mean keeping the key in a second place to compare against, and would accept anything that
 * merely looked like it. Asking the API to do something only the service role can do is the
 * question actually being asked. listUsers is read-only and cheap.
 *
 * Duplicated in the other scheduled function rather than shared. These are deployed one file
 * at a time through the dashboard editor, because the CLI needs a personal access token this
 * machine does not have; a ../_shared import would simply not resolve once deployed.
 */
async function callerMayRunJobs(asCaller: SupabaseClient, withToken: SupabaseClient) {
  const { data: isAdmin, error } = await asCaller.rpc('is_admin');
  if (!error && isAdmin === true) return { allowed: true, as: 'admin' as const };
  try {
    const probe = await withToken.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (!probe.error) return { allowed: true, as: 'service' as const };
  } catch { /* not the service key; falls through to refusal */ }
  return { allowed: false, as: null, error: error?.message };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401);

  const asCaller = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const withToken = createClient(SUPABASE_URL, authHeader.slice(7), { auth: { persistSession: false } });
  const who = await callerMayRunJobs(asCaller, withToken);
  if (!who.allowed) {
    return json({ error: who.error ? `Could not check permissions: ${who.error}` : 'Admins only' },
                who.error ? 500 : 403);
  }

  const body = await req.clone().json().catch(() => ({}));
  // A dry run reports what it would remove and removes nothing, which is how to check the
  // bands behave before letting them loose on real history.
  const dryRun = body.dryRun === true;

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const started = Date.now();

  const { data, error } = await db.rpc('thin_price_history', {
    p_source_id: SOURCE_ID,
    p_dry_run: dryRun,
  });

  const ms = Date.now() - started;

  if (error) {
    await db.rpc('record_sync_day', {
      p_source_id: SOURCE_ID, p_job: 'thin', p_status: 'error',
      p_ms: ms, p_note: error.message,
    });
    return json({ error: error.message }, 500);
  }

  if (!dryRun) {
    await db.rpc('record_sync_day', {
      p_source_id: SOURCE_ID, p_job: 'thin', p_status: 'ok',
      p_series: data.before ?? 0, p_rows: data.removed ?? 0, p_ms: ms,
      p_note: `${(data.removed ?? 0).toLocaleString()} points removed, ${(data.after ?? 0).toLocaleString()} kept`,
    });
  }

  return json({ ok: true, dryRun, durationMs: ms, ...data });
});
