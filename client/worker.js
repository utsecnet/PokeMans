/**
 * Serves the app, and its images, from pokemans.utsec.net.
 *
 * Two jobs, split on the path:
 *
 *   /images/*   the R2 bucket, read through a binding
 *   everything else   the built client
 *
 * Reading R2 through a binding rather than over its own public hostname is what lets the
 * bucket stay private. Nothing but this Worker can reach it, so there is no second address
 * handing out objects and no public endpoint to find. It is also a shorter path: the request
 * never leaves Cloudflare's edge to come back in.
 *
 * A subdomain rather than a path under www, so the app is mounted at the root in both of its
 * homes -- this origin and the Capacitor WebView. That symmetry is the whole reason for the
 * choice: no base path in the build, no basename on the router, no prefix to strip here, and
 * no class of bug where asset URLs and asset files disagree about where they live.
 */
const IMAGES = '/images/';

/**
 * Full-size card art, captured the first time anyone looks at it.
 *
 * Most cards have no vendored hi-res copy -- 246 of 20,635 at the time of writing -- and the
 * client used to paper over that by fetching images.pokemontcg.io itself, once per view,
 * forever, from the browser. Doing it here instead means the page only ever talks to this
 * origin, and the second viewer of a card is served from R2.
 *
 * The capture stores the upstream png as-is, because the conversion cannot happen here.
 * cardart.mjs converts with sharp, a native binary that a Worker isolate cannot load, and a
 * wasm avif encoder wants seconds of CPU against a 10ms budget. So the raw file is parked in
 * HI_RAW and cardart.mjs drains it into HI_OUT later, which is a batch job that already
 * exists. Until it runs, the first viewer pays 754KB where the converted copy is 56KB.
 */
const HI_OUT = 'cards-hi/';
const HI_RAW = 'cards-hi-raw/';

/**
 * Splits a card id into the set and number that address it upstream.
 *
 * "base1-4" is set base1 number 4, and the last hyphen is the divider because set ids contain
 * them too -- "tk1a-1" is tk1a number 1, not tk and "1a-1". Numbers holding a character that
 * safeFileName encoded (a slash, a star) will not round-trip; those miss upstream and fall
 * through to a 404, which is the same answer they get today.
 */
function upstreamFor(cardId) {
  const cut = cardId.lastIndexOf('-');
  if (cut <= 0 || cut === cardId.length - 1) return null;
  const setId = cardId.slice(0, cut);
  const number = cardId.slice(cut + 1);
  return `https://images.pokemontcg.io/${setId}/${encodeURIComponent(number)}_hires.png`;
}

/**
 * The second source, for the cards the first one has never heard of.
 *
 * images.pokemontcg.io lags the newest sets badly -- every card checked in Mega Evolution and
 * the 30th anniversary sets 404s there while TCGplayer has all of them. 400w is the ceiling:
 * 1000w answers 403, so this is 400px against pokemontcg.io's 600 to 756, which is why it is
 * second and not first.
 *
 * The product id arrives as a query parameter because the client already looks it up from
 * price_map to render prices. Fetching it here instead would mean a Supabase round trip from
 * the edge and the service key living in a Worker secret, to learn something the caller
 * already knows.
 */
function tcgplayerFor(productId) {
  if (!/^[0-9]{1,12}$/.test(productId ?? '')) return null;   // it only ever addresses a number
  return `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_400w.jpg`;
}

/**
 * Fetches card art from a source, or nothing.
 *
 * The status check is the whole point. images.pokemontcg.io answers a card it does not hold
 * with 404 and a real 186KB png of the back of a card -- not an error page, a picture that
 * decodes. An <img> never sees the status, which is why card backs used to appear in the
 * lightbox. Here it would be worse than a wrong picture: the back would be written into R2
 * under that card's name and served to everyone from then on, and no retry would ever
 * correct it.
 */
async function fetchUpstream(url) {
  let res;
  try {
    res = await fetch(url, { cf: { cacheTtl: 0 } });
  } catch {
    return null;                                   // offline, rate limited, host down
  }
  if (!res.ok) return null;                        // the card-back case
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) return null;
  return res;
}

/**
 * A year, immutable.
 *
 * A filename is derived from a card id and that artwork does not change. When one does, the
 * fix is to delete the object, not to weaken the header for the other 23,000.
 */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Only what the vendor scripts actually write. */
const TYPES = {
  avif: 'image/avif',
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
};

function imageHeaders(object, key) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', IMMUTABLE);
  // The uploader sets this, but an object written by some other route might not.
  if (!headers.has('content-type')) {
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    headers.set('content-type', TYPES[ext] ?? 'application/octet-stream');
  }
  // For the Capacitor WebView, which loads from https://localhost and is cross-origin against
  // this host. Read-only and unauthenticated, so a wider origin list gives nothing away.
  headers.set('access-control-allow-origin', '*');
  headers.set('accept-ranges', 'bytes');
  return headers;
}

/**
 * The converted copy, else the captured one, else go and get it.
 *
 * Returns null when the converted copy exists, so the ordinary read below handles it with
 * the range and conditional support that path already has. Only the uncommon cases -- not
 * yet converted, or not yet seen at all -- are answered here, and they are answered whole,
 * because a client asking for a byte range of a file that does not exist yet is not a case
 * worth carrying.
 */
async function serveOrCaptureHiRes(key, request, env, ctx, productId) {
  if (await env.IMAGES.head(key)) return null;

  const cardId = key.slice(HI_OUT.length, -'.avif'.length);

  // Captured but not yet converted. Either extension may be waiting: pokemontcg.io serves
  // png and TCGplayer serves jpeg, and the staged file keeps whichever it actually is so the
  // drain can hand sharp something that matches its bytes.
  for (const ext of ['png', 'jpg']) {
    const rawKey = `${HI_RAW}${cardId}.${ext}`;
    const raw = await env.IMAGES.get(rawKey);
    if (!raw) continue;
    const headers = imageHeaders(raw, rawKey);
    headers.set('content-length', String(raw.size));
    return new Response(request.method === 'HEAD' ? null : raw.body, { status: 200, headers });
  }

  // Best source first. TCGplayer caps at 400px, so it is only worth reaching for once
  // pokemontcg.io has said no.
  const sources = [
    { url: upstreamFor(cardId), type: 'image/png', ext: 'png' },
    { url: tcgplayerFor(productId), type: 'image/jpeg', ext: 'jpg' },
  ].filter((s) => s.url);

  for (const source of sources) {
    const res = await fetchUpstream(source.url);
    if (!res) continue;

    // One body, two consumers: the viewer waiting on it and the bucket. tee() lets the write
    // happen alongside the response rather than after it, so nobody waits for R2.
    const [toViewer, toBucket] = res.body.tee();
    ctx.waitUntil(
      env.IMAGES.put(`${HI_RAW}${cardId}.${source.ext}`, toBucket, {
        httpMetadata: { contentType: source.type, cacheControl: IMMUTABLE },
      }).catch(() => {
        // A failed capture costs one re-fetch next time and nothing else. Never let it reach
        // the viewer, who already has their picture.
      }),
    );

    const headers = new Headers({
      'content-type': source.type,
      'cache-control': IMMUTABLE,
      'access-control-allow-origin': '*',
    });
    return new Response(request.method === 'HEAD' ? null : toViewer, { status: 200, headers });
  }

  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith(IMAGES)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
      }

      const key = decodeURIComponent(url.pathname.slice(IMAGES.length));
      if (!key || key.includes('..')) return new Response('Not found', { status: 404 });

      // Hi-res art is the one thing that can be missing and then stop being missing. Checked
      // before the ordinary read so the two staging locations are tried in order.
      if (key.startsWith(HI_OUT) && key.endsWith('.avif')) {
        const captured = await serveOrCaptureHiRes(key, request, env, ctx, url.searchParams.get('tcg'));
        if (captured) return captured;
      }

      // Whether this is a range response is decided by the request, not by the reply. R2
      // fills in object.range whenever headers are handed to get(), describing the span it
      // returned -- which for an ordinary GET is the whole object. Trusting it meant every
      // image came back 206 with no content-range and no content-length, which is a
      // malformed partial response that happens to render in curl.
      const wantsRange = request.headers.has('range');

      const object = await env.IMAGES.get(key, {
        range: wantsRange ? request.headers : undefined,
        onlyIf: request.headers,
      });
      if (!object) return new Response('Not found', { status: 404 });

      const headers = imageHeaders(object, key);

      // get() returns a body only when the conditional check passed; without one this is a
      // 304, and the status has to say so rather than sending an empty 200.
      if (!('body' in object)) return new Response(null, { status: 304, headers });

      if (wantsRange && object.range) {
        // R2 gives either {offset, length} or {suffix}; both have to become one content-range.
        const { offset = 0, length, suffix } = object.range;
        const start = suffix === undefined ? offset : object.size - suffix;
        const count = suffix === undefined ? (length ?? object.size - start) : suffix;
        headers.set('content-range', `bytes ${start}-${start + count - 1}/${object.size}`);
        headers.set('content-length', String(count));
        return new Response(object.body, { status: 206, headers });
      }

      headers.set('content-length', String(object.size));
      return new Response(object.body, { status: 200, headers });
    }

    return env.ASSETS.fetch(request);
  },
};
