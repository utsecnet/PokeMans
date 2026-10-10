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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith(IMAGES)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
      }

      const key = decodeURIComponent(url.pathname.slice(IMAGES.length));
      if (!key || key.includes('..')) return new Response('Not found', { status: 404 });

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
