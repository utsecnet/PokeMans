/**
 * Moves an anonymous session's collections and want lists into the account you just
 * signed in to.
 *
 * Needed because an anonymous visitor who signs in with a Google account that already
 * exists here cannot link the two — the identity is taken. Without this, the only answers
 * were to abandon what they built or refuse the sign-in, and both are bad answers to a
 * situation the app created.
 *
 * Two tokens, and that is the point. The header carries the account signing in; the body
 * carries the anonymous session being emptied. Each is verified against the auth server
 * independently, so the caller has to actually hold both — naming someone else's user id
 * proves nothing and gets nowhere.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

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

  const body = await req.json().catch(() => ({}));
  const anonToken = String(body.anonymousAccessToken ?? '');
  if (!anonToken) return json({ error: 'No anonymous session supplied' }, 400);

  const auth = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

  // Whoever is signing in. getUser validates the token with the auth server rather than
  // trusting its contents, which is the difference between checking and reading.
  const { data: target, error: targetErr } = await auth.auth.getUser(authHeader.slice(7));
  if (targetErr || !target.user) return json({ error: 'Your session is not valid' }, 401);

  // The session being emptied. Verified the same way, so holding the id is not enough —
  // the caller must hold a working token for it.
  const { data: source, error: sourceErr } = await auth.auth.getUser(anonToken);
  if (sourceErr || !source.user) return json({ error: 'That browser session has expired' }, 401);

  if (!source.user.is_anonymous) {
    return json({ error: 'Only an anonymous session can be merged' }, 400);
  }
  if (source.user.id === target.user.id) {
    return json({ moved: false, reason: 'same account' });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await db.rpc('merge_anonymous_account', {
    p_from: source.user.id,
    p_to: target.user.id,
  });
  if (error) return json({ error: error.message }, 500);
  return json(data);
});
