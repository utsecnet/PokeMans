import { useEffect, useRef, useState } from 'react';
import { fetchCard } from '../lib/api';
import type { CardListItem } from '../types';
import { TypeBadge } from './TypeBadge';
import { CardLocationBadge } from './CardLocationBadge';
import { PriceHistoryChart } from './PriceHistoryChart';
import { TiltCard } from './TiltCard';
import { isStarRarity } from './RarityIcon';

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

  const image = card.imageLarge ?? card.imageSmall;

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
            stars={isStarRarity(card.rarity)}
            onActivate={() => setExpanded(true)}
            className="mx-auto w-full shrink-0 cursor-zoom-in self-start sm:w-1/2"
            imageClassName="max-h-[70vh]"
          />
        )}

        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold">{card.name}</h2>
              {/* The series wordmark, sized by height so the varying widths (2:1 through
                  5:1) all sit on one baseline instead of each setting its own. Right-aligned
                  and out of the text column, since it is era at a glance, not a label. */}
              {card.seriesLogoUrl && (
                <img
                  src={card.seriesLogoUrl}
                  alt={card.series ? `${card.series} series` : ''}
                  title={card.series ?? undefined}
                  loading="lazy"
                  className="h-6 w-auto max-w-[9rem] shrink-0 object-contain"
                />
              )}
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">
              {card.setName}
              {card.number ? ` · #${card.number}` : ''}
              {card.rarity ? ` · ${card.rarity}` : ''}
              {card.illustrator ? ` · ${card.illustrator}` : ''}
            </p>
          </div>

          {card.types.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {card.types.map((t) => (
                <TypeBadge key={t} type={t} />
              ))}
            </div>
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
            stars={isStarRarity(card.rarity)}
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
