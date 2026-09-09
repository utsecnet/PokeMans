import { Capacitor } from '@capacitor/core';

/**
 * Card art, cached onto the device the first time it is seen.
 *
 * Shipping the artwork is not an option — measured, the smallest usable card images total
 * 458 MB against a 200 MB base module, before the ~1,500 cards a year that follow. Hotlinking
 * every view is the other extreme: it needs a network for a collection you already own, and
 * it points an installed base at someone else's CDN.
 *
 * So each image is fetched once, written into app-private storage, and served from there
 * afterwards. A realistic user touches a few hundred cards, which is 10–25 MB. Everything
 * looked at once works offline, and the app stays a consumer of the art rather than a
 * redistributor of it.
 *
 * Sprites are not handled here: all 1,079 come to about 1 MB and ship with the app, rewritten
 * to /sprites/* by the server. This is only for the art too large to bundle.
 */
export interface ImageCache {
  /**
   * A URL the browser can render — the cached copy where one exists, the original otherwise.
   * Never rejects: a cache miss, a failed write or a broken filesystem all fall back to the
   * remote URL, because a slow image is a far better outcome than a missing one.
   */
  resolve(url: string | null | undefined): Promise<string | null>;
  /** Fetches ahead of time, for cards already known to matter — collections and want lists. */
  prime(urls: (string | null | undefined)[]): Promise<void>;
}

/**
 * The browser has its own HTTP cache and no app-private storage to write to, so there is
 * nothing useful to add here. Kept as a real implementation rather than a null check at every
 * call site, so the same component code runs in both places.
 */
const passthrough: ImageCache = {
  async resolve(url) {
    return url ?? null;
  },
  async prime() {},
};

/** Filesystem-safe, stable, and short. Not security-sensitive — only a filename. */
function cacheKey(url: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < url.length; i++) {
    h1 = Math.imul(h1 ^ url.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 + url.charCodeAt(i), 2246822519);
  }
  const ext = /\.(webp|png|jpg|jpeg)(\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'img';
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}.${ext}`;
}

/**
 * Resolutions already made this session.
 *
 * Without it every remount re-asks the filesystem for a path that cannot have changed, and a
 * scrolling grid remounts constantly. Holds the resolved URL, not the bytes — the WebView's
 * own image cache handles the decoding.
 */
const resolved = new Map<string, string>();
/** In-flight fetches, so a grid scrolling past the same card twice fetches it once. */
const inFlight = new Map<string, Promise<string>>();

function createNativeCache(): ImageCache {
  const DIR = 'card-art';
  let ready: Promise<typeof import('@capacitor/filesystem')> | null = null;

  // Imported lazily so the web build never pulls the plugin into its bundle.
  const fs = async () => {
    if (!ready) ready = import('@capacitor/filesystem');
    return ready;
  };

  const cache: ImageCache = {
    async resolve(url) {
      if (!url) return null;
      const hit = resolved.get(url);
      if (hit) return hit;
      const running = inFlight.get(url);
      if (running) return running;

      const task = (async () => {
        try {
          const { Filesystem, Directory } = await fs();
          const path = `${DIR}/${cacheKey(url)}`;

          try {
            const stat = await Filesystem.stat({ path, directory: Directory.Data });
            if (stat.size > 0) {
              const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
              const local = Capacitor.convertFileSrc(uri);
              resolved.set(url, local);
              return local;
            }
          } catch {
            // Not cached yet — fall through and fetch it.
          }

          const res = await fetch(url);
          if (!res.ok) return url;
          const blob = await res.blob();
          const data = await new Promise<string>((ok, no) => {
            const reader = new FileReader();
            reader.onerror = () => no(reader.error);
            // Filesystem.writeFile takes base64; the data: prefix has to come off.
            reader.onload = () => ok(String(reader.result).split(',')[1] ?? '');
            reader.readAsDataURL(blob);
          });

          await Filesystem.mkdir({ path: DIR, directory: Directory.Data, recursive: true }).catch(() => {});
          await Filesystem.writeFile({ path, data, directory: Directory.Data });

          const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
          const local = Capacitor.convertFileSrc(uri);
          resolved.set(url, local);
          return local;
        } catch {
          // Storage full, permission refused, plugin missing — show the remote image.
          return url;
        } finally {
          inFlight.delete(url);
        }
      })();

      inFlight.set(url, task);
      return task;
    },

    async prime(urls) {
      // Sequential on purpose: priming happens in the background behind whatever the user is
      // actually looking at, and it must not compete with it for bandwidth.
      for (const url of urls) {
        if (url && !resolved.has(url)) await cache.resolve(url);
      }
    },
  };

  return cache;
}

export const imageCache: ImageCache = Capacitor.isNativePlatform()
  ? createNativeCache()
  : passthrough;

/** True where caching does anything, so callers can skip priming work that would be a no-op. */
export const imageCacheIsActive = Capacitor.isNativePlatform();
