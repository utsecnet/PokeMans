import type { ReactNode } from 'react';

/**
 * The symbol printed in a card's bottom corner, drawn rather than fetched — the sets dataset
 * ships a symbol per *set*, never per rarity.
 *
 * The printed vocabulary is small: a circle, a diamond, a star, and later a handful of star
 * variants. The ~30 rarity strings in the catalogue are mostly qualifiers on those four
 * ("Rare Holo VMAX" is a star), so they are matched by pattern rather than listed one by one —
 * a list would need editing every time a set invents another name for a star.
 */
import type { Shape } from '../types';
export type { Shape };

export const SHAPES: Record<Shape, ReactNode> = {
  circle: <circle cx="12" cy="12" r="6.5" />,
  diamond: <path d="M12 4 20 12 12 20 4 12z" />,
  star: <path d="M12 3.5 14.6 9.4 21 10.2 16.3 14.5 17.6 21 12 17.8 6.4 21 7.7 14.5 3 10.2 9.4 9.4z" />,
  'double-star': (
    <>
      <path d="M8 4.5 9.9 8.8 14.5 9.4 11.1 12.5 12 17 8 14.7 4 17 4.9 12.5 1.5 9.4 6.1 8.8z" />
      <path d="M17 9 18.4 12.2 21.8 12.6 19.3 14.9 20 18.3 17 16.6 14 18.3 14.7 14.9 12.2 12.6 15.6 12.2z" />
    </>
  ),
  crown: <path d="M3 18h18l-1.6-9-4.4 3.4L12 6l-3 6.4L4.6 9z" />,
  promo: <path d="M12 3.5 14.6 9.4 21 10.2 16.3 14.5 17.6 21 12 17.8 6.4 21 7.7 14.5 3 10.2 9.4 9.4z M12 8.5l-1.2 2.8-3 .4 2.2 2-.6 3 2.6-1.5 2.6 1.5-.6-3 2.2-2-3-.4z" />,
};

/** Order matters: the first match wins, so the more specific patterns come first. */
const RULES: { test: RegExp; shape: Shape; tone: string }[] = [
  { test: /^common$/i, shape: 'circle', tone: '#6b7280' },
  { test: /^uncommon$/i, shape: 'diamond', tone: '#4d7c4d' },
  { test: /promo/i, shape: 'promo', tone: '#c2410c' },
  { test: /hyper|secret|rainbow|crown/i, shape: 'crown', tone: '#a16207' },
  { test: /double|ultra|illustration|special/i, shape: 'double-star', tone: '#7c3aed' },
  { test: /rare/i, shape: 'star', tone: '#b45309' },
];

const FALLBACK = { shape: 'circle' as Shape, tone: '#6b7280' };

export function rarityGlyph(rarity: string) {
  return RULES.find((r) => r.test.test(rarity)) ?? FALLBACK;
}

/** The shapes that are a star of some kind — everything the printed symbol marks as rare. */
const STARRED: Shape[] = ['star', 'double-star', 'crown'];

/**
 * Whether a rarity is drawn with a star, which is the same question as whether it is rare.
 * Read off the glyph rules above rather than matched separately, so the card that shows a
 * star in the sidebar is exactly the card that catches star-shaped light in the tilt view.
 * Promos are excluded by having a shape of their own: a promo is a distribution channel, and
 * a promo of a Common is still a Common.
 */
export function isStarRarity(rarity: string | null | undefined) {
  return rarity ? STARRED.includes(rarityGlyph(rarity).shape) : false;
}

/**
 * Which foil a card is printed with, as far as the tilt view is concerned.
 *
 * Not a cosmetic grading of rarity: these are four physically different materials, and the
 * light does different things to each. A 1999 holo and a 2024 Hyper Rare are both "rare"
 * and look nothing alike in the hand.
 *
 *   cosmos    The swirling galaxy foil of the WotC era, and only inside the illustration
 *             window -- the border of a Base Set holo is plain card stock. Dated rather
 *             than named, because the rarity string is the same "Rare Holo" either side of
 *             the handover; Nintendo took the licence in mid-2003 and the foil changed.
 *   etch      Illustration and Ultra Rares, whose foil is etched in fine parallel lines
 *             across the whole face rather than stamped in shapes.
 *   sparkle   Hyper, Secret and Rainbow Rares: dense fine glitter over everything.
 *   stars     Everything else the catalogue marks with a star.
 */
export type FoilKind = 'cosmos' | 'etch' | 'sparkle' | 'stars';

/** When Nintendo took the licence from Wizards of the Coast and the foil stock changed. */
const WOTC_ENDS = '2003-07-01';

export function foilFor(
  rarity: string | null | undefined,
  releaseDate: string | null | undefined,
): FoilKind | null {
  if (!rarity) return null;
  const { shape } = rarityGlyph(rarity);
  if (!STARRED.includes(shape)) return null;
  if (shape === 'crown') return 'sparkle';
  if (shape === 'double-star') return 'etch';
  // A plain star, so the era decides.
  return releaseDate && releaseDate < WOTC_ENDS ? 'cosmos' : 'stars';
}

export function RarityIcon({ rarity }: { rarity: string; active?: boolean }) {
  const { shape, tone } = rarityGlyph(rarity);

  // Always coloured: the tone is half of what separates a star from a star, and unlike the
  // type chips there is no coloured background here for it to compete with — selection is
  // shown by the checkbox beside it.
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: tone }}
      title={rarity}
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" className="text-white" aria-hidden="true">
        {SHAPES[shape]}
      </svg>
    </span>
  );
}
