/**
 * Applies the retention bands to stored price history.
 *
 *     0-7 days      every day
 *     8-30 days     every 2nd day
 *     31-365 days   every 3rd day
 *     365+ days     every 7th day
 *
 * All the thinking lives in the thin_price_history function; this is the door the schedule
 * knocks on. The work is a handful of deletes over indexed ranges, so it finishes in well
 * under the time limit and needs no batching.
 *
 * Deploy:
 *   npx supabase functions deploy thin-price-history --project-ref xamyixuipbkyzssvxchc
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401);

  const asCaller = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr) return json({ error: `Could not check permissions: ${adminErr.message}` }, 500);
  if (isAdmin !== true) return json({ error: 'Admins only' }, 403);

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
