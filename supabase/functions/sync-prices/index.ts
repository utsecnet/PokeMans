/**
 * Daily price capture, as an Edge Function.
 *
 * Prices the cards people actually hold — the union of every user's collections and want
 * lists — rather than the whole 20,635-card catalogue. That is what the single-user
 * server did for one person, and it is still the right scope: TCGdex has no bulk pricing
 * endpoint (their GraphQL schema exposes no pricing field at all), so this is one request
 * per card, and walking the full catalogue daily would be 20,635 requests against a free
 * API for cards nobody owns.
 *
 * Prices are shared. One run serves every user, so the second person to want a card pays
 * nothing for its price.
 *
 * Deploy:
 *   npx supabase functions deploy sync-prices --project-ref xamyixuipbkyzssvxchc
 *
 * Invoke: POST with the caller's own access token. The function refuses anyone who is not
 * an admin, checking with *their* token before it touches the service role.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TCGDEX = 'https://api.tcgdex.net/v2/en/cards';

/** One request per card, three at a time. Polite to a free API and well short of a limit. */
const CONCURRENCY = 3;
/**
 * A hard stop, because an Edge Function has a wall-clock limit and a run that is killed
 * halfway records nothing. Each invocation prices at most this many cards and reports how
 * many are left, so a caller — the admin button, or a scheduled trigger — can simply run
 * it again. Resumability comes free: a card priced today is skipped by the next run.
 */
const DEFAULT_LIMIT = 400;
/** A ceiling on a single-card request, so "price these" cannot become "price everything". */
const MAX_ON_DEMAND = 5;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

// ---------------------------------------------------------------- price mapping
//
// Ported from server/src/lib/cardPricing.js. The fallbacks below look lenient and are
// deliberate; each one exists because a card was otherwise losing the only price it had.

const TCGPLAYER_KEYS: Record<string, string[]> = {
  normal: ['normal'],
  holo: ['holofoil', 'holo'],
  reverse: ['reverse-holofoil', 'reverseHolofoil', 'reverse'],
};

interface Variant { position: number; type: string }
interface PriceRow {
  card_id: string;
  variant_position: number;
  source: string;
  currency: string;
  market: number | null;
  low: number | null;
  captured_on: string;
}

function rowsForCard(
  cardId: string,
  variants: Variant[],
  pricing: Record<string, any> | null,
  capturedOn: string,
): PriceRow[] {
  if (!pricing) return [];
  const rows: PriceRow[] = [];
  const soleVariant = variants.length === 1;

  for (const variant of variants) {
    const tp = pricing.tcgplayer ?? null;
    if (tp) {
      const finishes = Object.keys(tp).filter((k) => tp[k] && typeof tp[k] === 'object');
      // A card printed one way and priced one way is that printing. TCGdex labels some of
      // them "normal" while pricing only the holofoil, and refusing the match there loses
      // the card's only price. Anything with more than one printing still has to match by
      // name, so a 1st Edition cannot inherit an Unlimited price.
      const key =
        (TCGPLAYER_KEYS[variant.type] ?? []).find((k) => finishes.includes(k)) ??
        (soleVariant && finishes.length === 1 ? finishes[0] : null);
      const bucket = key ? tp[key] : null;
      if (bucket && (bucket.marketPrice != null || bucket.lowPrice != null)) {
        rows.push({
          card_id: cardId,
          variant_position: variant.position,
          source: 'tcgplayer',
          currency: String(tp.unit ?? 'USD'),
          market: bucket.marketPrice ?? null,
          low: bucket.lowPrice ?? null,
          captured_on: capturedOn,
        });
      }
    }

    const cm = pricing.cardmarket ?? null;
    if (cm) {
      // A holo printing reads the "-holo" figures; every other finish reads the base ones,
      // since Cardmarket publishes no reverse-specific series.
      let suffix = variant.type === 'holo' ? '-holo' : '';
      const has = (sfx: string) =>
        typeof cm[`trend${sfx}`] === 'number' || typeof cm[`avg${sfx}`] === 'number';
      if (!has(suffix) && soleVariant && has('-holo')) suffix = '-holo';
      const value =
        typeof cm[`trend${suffix}`] === 'number' ? cm[`trend${suffix}`]
        : typeof cm[`avg${suffix}`] === 'number' ? cm[`avg${suffix}`]
        : null;
      if (value != null) {
        rows.push({
          card_id: cardId,
          variant_position: variant.position,
          source: 'cardmarket',
          currency: String(cm.unit ?? 'EUR'),
          market: value,
          low: typeof cm[`low${suffix}`] === 'number' ? cm[`low${suffix}`] : null,
          captured_on: capturedOn,
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------- handler

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Authorise as the caller, before anything touches the service role. The anon key alone
  // proves nothing; the access token is what names a user.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401);

  const asCaller = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const requested = await req.clone().json().catch(() => ({}));
  const wanted: string[] = Array.isArray(requested.cardIds)
    ? requested.cardIds.filter((c: unknown) => typeof c === 'string').slice(0, MAX_ON_DEMAND)
    : [];

  // Two jobs behind one door.
  //
  // Naming cards is the card view asking for the one it is showing, so that a card nobody
  // owns still has a price when someone looks at it. Any signed-in account may do that: it
  // is bounded to a handful of cards, it skips anything already priced today, and the
  // result is shared, so the second person to open that card costs nothing at all.
  //
  // Naming none is the whole daily capture, which walks every card anyone holds. That is
  // the admin's job and stays theirs.
  if (wanted.length === 0) {
    const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
    if (adminErr) return json({ error: `Could not check permissions: ${adminErr.message}` }, 500);
    if (isAdmin !== true) return json({ error: 'Admins only' }, 403);
  } else {
    // A browsing session cannot trigger outbound requests; an account is the rate limit.
    const { data: real, error: realErr } = await asCaller.rpc('is_real_account');
    if (realErr) return json({ error: `Could not check permissions: ${realErr.message}` }, 500);
    if (real !== true) return json({ error: 'Sign in to price a card' }, 403);
  }

  // From here on the service role is in play: it must write price tables that no user may
  // write, and must read every user's collection to know which cards matter.
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const body = requested;
  const limit = Math.min(2000, Math.max(1, Number(body.limit) || DEFAULT_LIMIT));
  const capturedOn = new Date().toISOString().slice(0, 10);

  const { data: run } = await db.from('sync_run').insert({ status: 'running' }).select().single();

  try {
    // Either the cards that were named, or every card anyone holds or wants. Distinct,
    // because the point is the card and not who has it — the price that results is shared.
    let interesting: string[];
    if (wanted.length > 0) {
      interesting = [...new Set(wanted)];
    } else {
      const [{ data: owned }, { data: onLists }] = await Promise.all([
        db.from('collection_entries').select('card_id'),
        db.from('want_list_entries').select('card_id').eq('state', 'want'),
      ]);
      interesting = [...new Set([
        ...(owned ?? []).map((r) => r.card_id),
        ...(onLists ?? []).map((r) => r.card_id),
      ])];
    }

    // Already priced today? Skip it. A price is a value for a day, so re-fetching one
    // already held spends a request to learn nothing.
    const { data: done } = await db
      .from('price_current').select('card_id').eq('captured_on', capturedOn);
    const already = new Set((done ?? []).map((r) => r.card_id));
    const todo = interesting.filter((id) => !already.has(id));
    const batch = todo.slice(0, limit);

    if (batch.length === 0) {
      await db.from('sync_run').update({
        status: 'success', finished_at: new Date().toISOString(),
        cards_seen: interesting.length, prices_read: 0, changed: 0, failed: 0,
      }).eq('id', run.id);
      return json({ ok: true, cardsSeen: interesting.length, priced: 0, changed: 0, remaining: 0,
        note: 'Everything already has today\'s price.' });
    }

    // The catalogue knows each card's TCGdex id and its printings.
    const { data: cards } = await db
      .from('tcg_cards').select('id,tcgdex_id').in('id', batch);
    const { data: variants } = await db
      .from('tcg_card_variants').select('card_id,position,type').in('card_id', batch);

    const variantsByCard = new Map<string, Variant[]>();
    for (const v of variants ?? []) {
      const list = variantsByCard.get(v.card_id) ?? [];
      list.push({ position: v.position, type: v.type });
      variantsByCard.set(v.card_id, list);
    }

    let priced = 0, failed = 0, unmatched = 0;
    const rows: PriceRow[] = [];
    const queue = [...(cards ?? [])];

    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0) {
        const card = queue.pop()!;
        // No TCGdex id means the enrichment pass found no confident match. Not a failure:
        // there is simply nothing upstream to ask for.
        if (!card.tcgdex_id) { unmatched++; continue; }
        try {
          const res = await fetch(`${TCGDEX}/${encodeURIComponent(card.tcgdex_id)}`);
          if (!res.ok) { failed++; continue; }
          const upstream = await res.json();
          const made = rowsForCard(
            card.id,
            variantsByCard.get(card.id) ?? [{ position: 0, type: 'normal' }],
            upstream.pricing ?? null,
            capturedOn,
          );
          if (made.length > 0) { rows.push(...made); priced++; }
        } catch {
          failed++;
        }
      }
    }));

    // One call, and Postgres decides what is new: record_prices upserts every row into
    // price_current and appends to price_history only where the price actually moved.
    let changed = 0;
    if (rows.length > 0) {
      const { data, error } = await db.rpc('record_prices', { payload: rows });
      if (error) throw new Error(`record_prices failed: ${error.message}`);
      changed = data ?? 0;
    }

    const remaining = todo.length - batch.length;
    await db.from('sync_run').update({
      status: failed > 0 ? 'partial' : 'success',
      finished_at: new Date().toISOString(),
      cards_seen: interesting.length,
      prices_read: rows.length,
      changed,
      failed,
    }).eq('id', run.id);

    return json({ ok: true, cardsSeen: interesting.length, priced, changed, failed, unmatched, remaining });
  } catch (err) {
    await db.from('sync_run').update({
      status: 'error', finished_at: new Date().toISOString(),
      error: String((err as Error)?.message ?? err),
    }).eq('id', run.id);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
