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

      const object = await env.IMAGES.get(key, {
        range: request.headers,
        onlyIf: request.headers,
      });
      if (!object) return new Response('Not found', { status: 404 });

      const headers = imageHeaders(object, key);
      // get() returns a body only when the conditional and range checks passed; without one
      // this is a 304, and the status has to say so rather than sending an empty 200.
      if (!('body' in object)) return new Response(null, { status: 304, headers });
      return new Response(object.body, { status: object.range ? 206 : 200, headers });
    }

    return env.ASSETS.fetch(request);
  },
};
