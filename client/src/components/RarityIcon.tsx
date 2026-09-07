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
type Shape = 'circle' | 'diamond' | 'star' | 'double-star' | 'crown' | 'promo';

const SHAPES: Record<Shape, ReactNode> = {
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

export function RarityIcon({ rarity, active }: { rarity: string; active: boolean }) {
  const { shape, tone } = rarityGlyph(rarity);
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors"
      style={{ backgroundColor: active ? tone : '#9ca3af' }}
      title={rarity}
    >
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="currentColor"
        className={active ? 'text-white' : 'text-white/80'}
        aria-hidden="true"
      >
        {SHAPES[shape]}
      </svg>
    </span>
  );
}
