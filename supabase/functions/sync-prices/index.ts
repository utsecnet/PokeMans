/**
 * The daily price capture.
 *
 * tcgcsv republishes TCGplayer's own daily figures, one file per set, so the whole catalogue
 * costs 220 requests and about three seconds rather than the 20,635 single-card calls the
 * previous source required. That is the difference between pricing the cards somebody
 * happens to own and pricing all of them, which is what a price index needs.
 *
 * Two pieces of their etiquette are honoured here, both stated on tcgcsv.com:
 *
 *   - A User-Agent identifying the caller. Without one the service answers 401, and the
 *     operator is one person paying for the bandwidth.
 *   - A price file is fetched at most once per 24 hours. This runs on a daily schedule and
 *     refuses to repeat a day it has already recorded unless explicitly told to.
 *
 * Deploy:
 *   npx supabase functions deploy sync-prices --project-ref xamyixuipbkyzssvxchc
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SOURCE_ID = 1;              // tcgplayer, per the price_source table
const TCGCSV_CATEGORY = 3;        // Pokemon
const BASE = 'https://tcgcsv.com/tcgplayer';

/** Identifies us to a free service run by one person. Not optional: without it, 401. */
const UA = {
  'User-Agent': 'PokeMans/1.0 (collection tracker; +https://github.com/utsecnet/PokeMans)',
};

/** Four at a time. 220 files land in roughly three seconds and nobody is inconvenienced. */
const CONCURRENCY = 4;

/**
 * Groups per invocation. The whole run fits comfortably inside the time limit, but a cap
 * means a slow day degrades into "finish next run" rather than being killed with nothing
 * recorded. The response reports what is left so a caller can simply call again.
 */
const DEFAULT_LIMIT = 260;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

interface PriceRow {
  productId: number;
  subTypeName: string;
  marketPrice: number | null;
  lowPrice: number | null;
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

  const body = await req.clone().json().catch(() => ({}));

  // Admins and the schedule only. This spends someone else's bandwidth and writes shared
  // data, so it is not something a signed-in browser may set off.
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr) return json({ error: `Could not check permissions: ${adminErr.message}` }, 500);
  if (isAdmin !== true) return json({ error: 'Admins only' }, 403);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const capturedOn = new Date().toISOString().slice(0, 10);
  const limit = Math.min(260, Math.max(1, Number(body.limit) || DEFAULT_LIMIT));
  const force = body.force === true;
  const started = Date.now();

  // Their rule, enforced on our side rather than trusted to the schedule: one fetch of a
  // given day's prices per day. Re-running is otherwise harmless -- record_prices is
  // idempotent -- but it would mean asking for files we already have.
  if (!force) {
    const { data: already } = await db
      .from('sync_day')
      .select('status, rows_written')
      .eq('source_id', SOURCE_ID).eq('job', 'prices').eq('ran_on', capturedOn)
      .maybeSingle();
    if (already && already.status !== 'error') {
      return json({
        ok: true, skipped: true,
        note: `Prices for ${capturedOn} were already captured. Pass force to repeat.`,
        rowsWritten: already.rows_written,
      });
    }
  }

  let groups: { groupId: number; name: string }[] = [];
  try {
    const res = await fetch(`${BASE}/${TCGCSV_CATEGORY}/groups`, { headers: UA });
    if (!res.ok) throw new Error(`groups: HTTP ${res.status}`);
    groups = (await res.json()).results ?? [];
  } catch (err) {
    await db.rpc('record_sync_day', {
      p_source_id: SOURCE_ID, p_job: 'prices', p_status: 'error',
      p_ms: Date.now() - started, p_note: `Could not list sets: ${(err as Error).message}`,
    });
    return json({ error: `Could not list sets: ${(err as Error).message}` }, 502);
  }

  const batch = groups.slice(0, limit);
  const collected: { externalId: number; subType: string; market: number | null; low: number | null }[] = [];
  let failures = 0;
  const queue = [...batch];

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const g = queue.pop()!;
      try {
        const res = await fetch(`${BASE}/${TCGCSV_CATEGORY}/${g.groupId}/prices`, { headers: UA });
        if (!res.ok) { failures++; continue; }
        const rows: PriceRow[] = (await res.json()).results ?? [];
        for (const r of rows) {
          // A row with neither figure carries nothing; recording it would only create a
          // history entry that says "we do not know", which is not worth bytes.
          if (r.marketPrice == null && r.lowPrice == null) continue;
          collected.push({
            externalId: r.productId,
            subType: r.subTypeName,
            market: r.marketPrice ?? null,
            low: r.lowPrice ?? null,
          });
        }
      } catch {
        failures++;
      }
    }
  }));

  // Postgres decides what is new. record_prices writes a history row only where the value
  // actually moved and bumps observed_on for everything else, so the ~77% of series that are
  // unchanged on a given day cost nothing but a date update.
  let result: Record<string, number> = {};
  try {
    const CHUNK = 20000;
    for (let i = 0; i < collected.length; i += CHUNK) {
      const { data, error } = await db.rpc('record_prices', {
        p_source_id: SOURCE_ID,
        p_captured_on: capturedOn,
        p_payload: collected.slice(i, i + CHUNK),
      });
      if (error) throw new Error(error.message);
      for (const [k, v] of Object.entries(data ?? {})) {
        result[k] = (result[k] ?? 0) + (v as number);
      }
    }
  } catch (err) {
    await db.rpc('record_sync_day', {
      p_source_id: SOURCE_ID, p_job: 'prices', p_status: 'error',
      p_series: collected.length, p_failures: failures,
      p_ms: Date.now() - started, p_note: `Writing prices failed: ${(err as Error).message}`,
    });
    return json({ error: `Writing prices failed: ${(err as Error).message}` }, 500);
  }

  const remaining = groups.length - batch.length;
  // A handful of unreachable set files is a warning, not a failure: the rest of the
  // catalogue priced fine and tomorrow will fill them in. Nothing written at all is an error
  // however green the individual requests looked.
  const status = (failures > 0 || remaining > 0) ? 'warn'
    : (result.changed ?? 0) === 0 && (result.unchanged ?? 0) === 0 ? 'error' : 'ok';

  const ms = Date.now() - started;
  await db.rpc('record_sync_day', {
    p_source_id: SOURCE_ID, p_job: 'prices', p_status: status,
    p_series: result.resolved ?? 0, p_rows: result.changed ?? 0,
    p_failures: failures, p_ms: ms,
    p_note: [
      failures > 0 ? `${failures} set files unreachable` : null,
      remaining > 0 ? `${remaining} sets left for the next run` : null,
      result.unmapped ? `${result.unmapped} products not in our catalogue` : null,
    ].filter(Boolean).join('; ') || null,
  });

  return json({
    ok: true, capturedOn, status,
    setsFetched: batch.length, failures, remaining,
    ...result, durationMs: ms,
  });
});
