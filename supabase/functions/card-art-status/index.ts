/**
 * Which cards have no thumbnail yet, and what it takes to fetch them.
 *
 * The Worker captures a card's art the first time anyone asks for it, so the gap closes on
 * its own as people browse. This is the proactive half: it names every card still missing so
 * the admin page can request them all at once rather than waiting for someone to open each.
 *
 * Reads the bucket over the S3 API, because a Worker binding is not reachable from here. The
 * credentials are the same read-write pair pushImages.mjs uses, held as function secrets.
 *
 * Admins only. Listing which images exist gives nothing away -- the images are served to
 * anyone -- but this is still an endpoint that walks a bucket and a catalogue, and nothing
 * on this site answers an anonymous caller that asks it to do work.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID')!;
const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID')!;
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY')!;
const R2_BUCKET = Deno.env.get('R2_BUCKET') ?? 'pokemans-images';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/**
 * The filename encoding the vendor scripts wrote with: anything outside [A-Za-z0-9.-] becomes
 * an underscore and the character's hex code.
 *
 * Must stay byte-exact with client/src/lib/localImages.ts and the catalogue scripts. A
 * mismatch here does not error -- it reports a card as missing that is already there, and the
 * sync fetches it again for nothing.
 */
function safeFileName(value: string): string {
  return value.replace(
    /[^a-zA-Z0-9.-]/g,
    (c) => '_' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'),
  );
}

// ---------------------------------------------------------------- S3 request signing
//
// Hand-rolled because Deno has no aws sdk here and the whole need is one GET with a query
// string. SigV4 is fiddly but it is forty lines, against pulling a dependency into a function
// deployed by pasting one file into a dashboard editor.

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

async function signedListUrl(prefix: string, token?: string): Promise<{ url: string; headers: HeadersInit }> {
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const params = new URLSearchParams({
    'list-type': '2',
    'max-keys': '1000',
    prefix,
  });
  if (token) params.set('continuation-token', token);
  params.sort();

  const canonicalRequest = [
    'GET',
    `/${R2_BUCKET}`,
    params.toString(),
    `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${amzDate}\n`,
    'host;x-amz-content-sha256;x-amz-date',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');

  let key: ArrayBuffer | Uint8Array = enc.encode(`AWS4${R2_SECRET_ACCESS_KEY}`);
  for (const part of [dateStamp, 'auto', 's3', 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, toSign));

  return {
    url: `https://${host}/${R2_BUCKET}?${params.toString()}`,
    headers: {
      host,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-amz-date': amzDate,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${scope}, ` +
        `SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
    },
  };
}

/** Every key under a prefix. One call per 1,000 objects, so about 21 for the thumbnails. */
async function listKeys(prefix: string): Promise<Set<string>> {
  const keys = new Set<string>();
  let token: string | undefined;
  do {
    const { url, headers } = await signedListUrl(prefix, token);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`R2 list failed: ${res.status} ${await res.text()}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.add(m[1]);
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    token = xml.includes('<IsTruncated>true</IsTruncated>') && next ? next[1] : undefined;
  } while (token);
  return keys;
}

/**
 * Admins, or the service key.
 *
 * Duplicated from sync-prices rather than shared: these are deployed one file at a time
 * through the dashboard editor, so a ../_shared import would not resolve once deployed.
 */
async function callerMayRunJobs(asCaller: SupabaseClient, withToken: SupabaseClient) {
  const { data: isAdmin, error } = await asCaller.rpc('is_admin');
  if (!error && isAdmin === true) return { allowed: true, error: undefined };
  try {
    const probe = await withToken.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (!probe.error) return { allowed: true, error: undefined };
  } catch { /* not the service key; falls through to refusal */ }
  return { allowed: false, error: error?.message };
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
    return json(
      { error: who.error ? `Could not check permissions: ${who.error}` : 'Admins only' },
      who.error ? 500 : 403,
    );
  }

  const started = Date.now();
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let have: Set<string>;
  try {
    have = await listKeys('cards/');
  } catch (err) {
    return json({ error: String((err as Error).message) }, 502);
  }

  // The whole catalogue, in pages, because PostgREST caps a response at 1,000 rows.
  const cards: { id: string; ref: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('tcg_cards').select('id,ref').range(from, from + 999);
    if (error) return json({ error: error.message }, 500);
    cards.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }

  const missing = cards.filter((c) => !have.has(`cards/${safeFileName(c.id)}.avif`));

  // The TCGplayer product id, for the cards images.pokemontcg.io does not have -- which is
  // most of what is missing, because what is missing is the newest sets. Looked up only for
  // those, not for all 20,000.
  const productIds = new Map<number, number>();
  for (let i = 0; i < missing.length; i += 300) {
    const refs = missing.slice(i, i + 300).map((c) => c.ref);
    const { data } = await db.from('price_map').select('card_ref,external_id').in('card_ref', refs);
    for (const row of data ?? []) {
      if (!productIds.has(row.card_ref)) productIds.set(row.card_ref, row.external_id);
    }
  }

  return json({
    total: cards.length,
    present: cards.length - missing.length,
    missing: missing.length,
    durationMs: Date.now() - started,
    // id and product id only: everything else the caller needs is derivable from the id.
    cards: missing.map((c) => ({ id: c.id, tcg: productIds.get(c.ref) ?? null })),
  });
});
