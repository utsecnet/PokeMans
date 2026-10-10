import { useEffect, useRef, useState } from 'react';
import { fetchCard, fetchTcgplayerProductId } from '../lib/api';
import type { CardListItem } from '../types';
import { TypeBadge } from './TypeBadge';
import { CardLocationBadge } from './CardLocationBadge';
import { PriceHistoryChart } from './PriceHistoryChart';
import { TiltCard } from './TiltCard';
import { foilFor } from './RarityIcon';

/**
 * The card view, opened from anywhere a card is clickable.
 *
 * Callers pass a `cardId` and, if they already hold the full record (the card browser
 * does), the `card` itself so it paints immediately. Everywhere else — the Pokémon page's
 * gallery, a collection, anything added later — passes only the id and this fetches the
 * rest, so no caller has to carry a complete card object around just to show it.
 */
export function CardLightbox({
  cardId,
  card: provided,
  onClose,
}: {
  cardId: string;
  card?: CardListItem;
  onClose: () => void;
}) {
  const [fetched, setFetched] = useState<CardListItem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Tagged with the card it belongs to: opening a different card must not show the previous
  // card's upgrade, and comparing here is simpler than resetting from an effect.
  const [hires, setHires] = useState<{ cardId: string; url: string } | null>(null);
  // The card art sets the height budget for the price history beside it — chart plus key
  // shouldn't run past the bottom of the card.
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageHeight, setImageHeight] = useState<number | null>(null);
  // Clicking the art blows it up to fill the screen; clicking again puts it back.
  const [expanded, setExpanded] = useState(false);
  const card = provided ?? fetched;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape backs out one layer at a time, so it doesn't discard the whole card view
      // when all the user wanted was to leave the blown-up art.
      if (expanded) setExpanded(false);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, expanded]);

  // Observed rather than measured on load: until the art decodes it's either zero-height or
  // a small broken-image box, and on a cold cache that was reaching the chart as its budget
  // and pinning it to its minimum for the life of the dialog. naturalHeight is what says the
  // measurement means anything; until it does, the chart gets no budget and picks its own
  // size. A ResizeObserver catches the real height whenever it lands, and covers viewport
  // resizes too, since the art is capped in vh.
  useEffect(() => {
    const el = imageRef.current;
    if (!el) return;
    const measure = () => setImageHeight(el.naturalHeight > 0 ? el.clientHeight || null : null);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [card]);

  // Upgrade the art, but only once the upgrade has proved it exists.
  //
  // localCardLarge builds a /cards-hi/ path for every card, because a browser cannot stat a
  // file. That is right for the thumbnails, where all 20,444 are vendored, and wrong here:
  // only cards someone has already opened have a full-size copy, 28 of them today. The view
  // trusted that path and showed a broken frame for every other card -- the dev server
  // answers a missing file with index.html, which an <img> cannot decode.
  //
  // So the large copy is decoded off-screen first and swapped in only if it really arrives.
  // The thumbnail is the floor and stands until then, which is what makes this work offline
  // and what will let it work unchanged when these files move to object storage.
  //
  // A call used to sit here asking the server to fetch and convert the scan on demand. It
  // needed sharp and a filesystem, so it could never run hosted -- and it had already
  // stopped running at all, gated on `!card.imageLarge`, which is never false now that the
  // path is always built.
  const largeUrl = card?.imageLarge ?? null;
  const largeFor = card?.id ?? null;

  // Fetches the full-size scan, which is always from our own origin now.
  //
  // The two upstream sources used to be fetched from here, which meant the page reached out
  // to images.pokemontcg.io on nearly every card -- 246 of 20,635 had a local copy -- and to
  // TCGplayer on the newest sets. The Worker does that now and keeps what it gets, so the
  // second person to open a card is served from R2 and the browser only ever talks to one
  // host.
  //
  // That also removes the blob dance. Those fetches had to check the HTTP status, because
  // pokemontcg.io answers a card it does not hold with 404 and a real png of the back of a
  // card, which an <img> cannot tell from the real thing. The Worker makes that check before
  // anything is stored, so a plain load is trustworthy again.
  useEffect(() => {
    setHires(null);
    if (!largeFor || !largeUrl) return;
    let cancelled = false;

    // A miss is still a load failure rather than an error we can read: the dev server answers
    // an absent file with index.html, which an <img> cannot decode.
    const load = (url: string) =>
      new Promise<boolean>((resolve) => {
        const pre = new Image();
        pre.onload = () => resolve(true);
        pre.onerror = () => resolve(false);
        pre.src = url;
      });

    (async () => {
      if (await load(largeUrl)) {
        if (!cancelled) setHires({ cardId: largeFor, url: largeUrl });
        return;
      }
      if (cancelled) return;

      // Nothing here and nothing at pokemontcg.io. TCGplayer may still have it -- it is
      // strongest on exactly the recent sets pokemontcg.io lags -- but it is addressed by
      // product id, which only this side knows, from the price mapping already loaded for
      // the price panel. Handing it over costs one query on a card that would otherwise show
      // no scan at all, and lets the Worker capture it like any other.
      const productId = await fetchTcgplayerProductId(largeFor);
      if (cancelled || !productId) return;

      const withProduct = `${largeUrl}?tcg=${productId}`;
      if (await load(withProduct) && !cancelled) {
        setHires({ cardId: largeFor, url: withProduct });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [largeFor, largeUrl]);

  useEffect(() => {
    if (provided) return;
    const controller = new AbortController();
    setFetched(null);
    setLoadError(null);
    fetchCard(cardId, controller.signal)
      .then(setFetched)
      .catch((err) => {
        if (controller.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : 'Could not load this card');
      });
    return () => controller.abort();
  }, [cardId, provided]);

  if (!card) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-busy={!loadError}
      >
        <div
          className="rounded-xl bg-[var(--color-surface)] px-6 py-4 text-sm text-[var(--color-text-muted)]"
          onClick={(e) => e.stopPropagation()}
        >
          {loadError ? `Could not load this card — ${loadError}` : 'Loading card…'}
        </div>
      </div>
    );
  }

  // The full-size art, but only if it decoded. Falling through to the thumbnail is the
  // normal case rather than the error case: most cards have no full-size copy.
  const upgraded = hires?.cardId === card.id ? hires.url : null;
  const image = upgraded ?? card.imageSmall;

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={card.name}
    >
      <div
        className="flex max-h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto rounded-xl bg-[var(--color-surface)] p-4 shadow-2xl sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* self-start stops the flex row stretching the image to the column height, which
            distorted the card; the max-* pair keeps its own aspect ratio whatever the box. */}
        {image && (
          <TiltCard
            src={image}
            alt={card.name}
            label={`${card.name} — enlarge`}
            imageRef={imageRef}
            foil={foilFor(card.rarity, card.releaseDate)}
            onActivate={() => setExpanded(true)}
            className="mx-auto w-full shrink-0 cursor-zoom-in self-start sm:w-1/2"
            imageClassName="max-h-[70vh]"
          />
        )}

        <div className="min-w-0 flex-1 space-y-4">
          {/* Laid out the way the card itself is printed: name and element together at the
              top, then the set, then the strip along the bottom edge that carries symbol,
              number, rarity and illustrator. Collectors already read a card in that order,
              so the panel does not ask them to learn a second one. */}
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-bold leading-tight">{card.name}</h2>
            {card.types.length > 0 && (
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {card.types.map((t) => (
                  <TypeBadge key={t} type={t} />
                ))}
              </div>
            )}
          </div>

          {/* One mark, big enough to read. Two were competing at sizes where neither was
              legible — the set logo is the more specific of them, so it stays and the series
              is spelled out underneath instead of being a second picture to squint at. */}
          <div className="flex items-center gap-3 border-t border-[var(--color-border)] pt-3">
            {(card.setLogoUrl || card.setSymbolUrl) && (
              <img
                src={card.setLogoUrl ?? card.setSymbolUrl ?? undefined}
                alt=""
                loading="lazy"
                className="h-10 w-auto max-w-[7.5rem] shrink-0 object-contain"
              />
            )}
            <div className="min-w-0">
              <p className="truncate font-medium leading-tight">{card.setName ?? 'Unknown set'}</p>
              {card.series && (
                <p className="truncate text-sm text-[var(--color-text-muted)]">{card.series} series</p>
              )}
            </div>
          </div>

          {/* A field is named or it is a guess: "Common" and "43" mean nothing on their own,
              and a middle-dot run makes the reader count positions to work out which is
              which. Only fields the card actually has get a column. */}
          {(card.number || card.rarity || card.illustrator) && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              {card.number && (
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--color-text-muted)]">Number</dt>
                  <dd className="mt-0.5 flex items-center gap-1.5">
                    {/* Beside the number because that is where it sits on the card. */}
                    {card.setSymbolUrl && (
                      <img
                        src={card.setSymbolUrl}
                        alt=""
                        loading="lazy"
                        className="h-3.5 w-3.5 shrink-0 object-contain"
                      />
                    )}
                    <span className="truncate">{card.number}</span>
                  </dd>
                </div>
              )}
              {card.rarity && (
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--color-text-muted)]">Rarity</dt>
                  <dd className="mt-0.5 truncate">{card.rarity}</dd>
                </div>
              )}
              {card.illustrator && (
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--color-text-muted)]">Illustrator</dt>
                  <dd className="mt-0.5 truncate" title={card.illustrator}>
                    {card.illustrator}
                  </dd>
                </div>
              )}
            </dl>
          )}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Price history
            </h3>
            <div className="mt-1">
              <PriceHistoryChart cardId={card.id} maxHeight={imageHeight} />
            </div>
          </div>

          {card.inBoxes.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                In your collection
              </h3>
              <div className="mt-1">
                <CardLocationBadge inBoxes={card.inBoxes} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Sits above the card view rather than replacing it, so collapsing puts the user back
        exactly where they were — same scroll position, same chart tab. */}
    {expanded && image && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
        onClick={() => setExpanded(false)}
        role="dialog"
        aria-modal="true"
        aria-label={`${card.name} — full size`}
      >
        {/* Swallows the click so a drag that rotates the card and happens to end on the
            backdrop doesn't also collapse it; tapping the card itself still does. */}
        <div onClick={(e) => e.stopPropagation()} className="max-h-full">
          <TiltCard
            src={image}
            alt={card.name}
            label={`${card.name} — shrink`}
            onActivate={() => setExpanded(false)}
            foil={foilFor(card.rarity, card.releaseDate)}
            maxTilt={16}
            className="cursor-zoom-out"
            imageClassName="max-h-[92vh]"
          />
        </div>
      </div>
    )}
    </>
  );
}
