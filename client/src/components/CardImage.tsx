import { useEffect, useRef, useState } from 'react';
import { imageCache, imageCacheIsActive } from '../lib/imageCache';

/**
 * A card image that comes from the device once it has been seen once.
 *
 * Drop-in for `<img>`: same props, same classes, same ref. On the web it is exactly an
 * `<img>` — `imageCache` is a passthrough there and the initial state is already the remote
 * URL, so there is no extra render and no flash. On Android the first view fetches and
 * writes the file, and every view afterwards reads it locally.
 *
 * Kept as a component rather than a hook so that swapping a call site is a one-word change
 * and no page has to think about caching at all.
 */
export function CardImage({
  src,
  alt,
  imgRef,
  ...rest
}: {
  src: string | null | undefined;
  alt: string;
  imgRef?: React.Ref<HTMLImageElement>;
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'ref'>) {
  // Starts at the remote URL so the image begins loading immediately; the cached path
  // replaces it if and when one resolves. Waiting for the cache before rendering anything
  // would trade a working image for a blank box on the one platform that needs it least.
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(src ?? null);
  const wantedRef = useRef(src);

  useEffect(() => {
    wantedRef.current = src;
    setResolvedSrc(src ?? null);
    if (!src || !imageCacheIsActive) return;

    let cancelled = false;
    imageCache
      .resolve(src)
      .then((next) => {
        // A scrolling grid reuses these components, so by the time this resolves the
        // component may be showing a different card entirely. Comparing against the ref
        // rather than the closure keeps a slow fetch from painting the wrong card.
        if (!cancelled && next && wantedRef.current === src) setResolvedSrc(next);
      })
      .catch(() => {
        /* resolve() already falls back to the remote URL; nothing to do. */
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!resolvedSrc) return null;
  return <img ref={imgRef} src={resolvedSrc} alt={alt} {...rest} />;
}
