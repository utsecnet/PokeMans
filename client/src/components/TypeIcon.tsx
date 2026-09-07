import type { ReactNode } from 'react';

// Small stylized glyphs per type, not official artwork — simple enough to read at ~12px.
// Filled with currentColor; a couple use stroke-only sub-shapes to "punch" an eye/hole
// through to the badge background, since we can't do true SVG cutouts inline here.
const TYPE_GLYPHS: Record<string, ReactNode> = {
  normal: <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="3" />,
  fire: (
    <path d="M12 2c-1 4-5 6-5 11a5 5 0 0 0 10 0c0-2-1-3-2-4 .3 2-.4 3-1.3 3.6C14.6 10.4 13 7.5 12 2z" />
  ),
  water: <path d="M12 2C7 8 4 12 4 15.5a8 8 0 0 0 16 0C20 12 17 8 12 2z" />,
  electric: <path d="M13 2 5 14h5l-1 8 9-12h-5l1-8z" />,
  grass: (
    <>
      <path d="M20 4C11 4 4 11 4 20c9 0 16-7 16-16z" />
      <path d="M6.5 17.5c3-6 7-9.5 11-11.5" fill="none" stroke="white" strokeOpacity="0.5" strokeWidth="1.2" />
    </>
  ),
  ice: (
    <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="4.5" y1="7.5" x2="19.5" y2="16.5" />
      <line x1="19.5" y1="7.5" x2="4.5" y2="16.5" />
    </g>
  ),
  fighting: (
    <>
      <rect x="7" y="9" width="10" height="9" rx="3" />
      <rect x="4.5" y="11" width="4" height="5" rx="2" />
    </>
  ),
  poison: (
    <>
      <circle cx="12" cy="10" r="6" />
      <rect x="9" y="14" width="6" height="4" rx="1" />
    </>
  ),
  ground: <path d="M2 18 12 5 22 18z" />,
  flying: <path d="M2 15c5-7 10-9 20-8-7 2-11 6-13 11-2-2-5-3-7-3z" />,
  psychic: (
    <>
      <path
        d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  bug: (
    <>
      <ellipse cx="12" cy="14" rx="5" ry="6" />
      <circle cx="12" cy="6.5" r="2.5" />
      <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <line x1="10" y1="4.5" x2="8.5" y2="2" />
        <line x1="14" y1="4.5" x2="15.5" y2="2" />
      </g>
    </>
  ),
  rock: <path d="M2 18 7 8 11 14 14 6 19 12 22 18z" />,
  ghost: (
    <>
      <path d="M12 3a7 7 0 0 0-7 7v9l2.5-2 2 2 2.5-2.5 2.5 2.5 2-2 2.5 2v-9a7 7 0 0 0-7-7z" />
      <circle cx="9.3" cy="10.5" r="1.3" fill="white" fillOpacity="0.6" />
      <circle cx="14.7" cy="10.5" r="1.3" fill="white" fillOpacity="0.6" />
    </>
  ),
  dragon: <path d="M4 20c2-10 8-16 16-18-2 6-2 10 2 12-6 0-10 2-12 6-2-1-4 0-6 0z" />,
  dark: <path d="M20.5 12.5a8.5 8.5 0 1 1-9-8.5 7 7 0 0 0 9 8.5z" />,
  steel: (
    <polygon
      points="12,3 19,7.5 19,16.5 12,21 5,16.5 5,7.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
  ),
  fairy: <path d="M12 2l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" />,
};

/**
 * The TCG prints its own energy names, which only partly overlap the Pokémon type names the
 * glyphs are keyed on: "Lightning" for electric, "Darkness" for dark, "Metal" for steel, and
 * "Colorless" with no Pokémon equivalent at all. Card names also arrive capitalised.
 *
 * Without this the card filters fell through to the fallback glyph on a grey chip — the same
 * icon and colour for every energy, which read as having no icons at all.
 */
const ENERGY_ALIASES: Record<string, string> = {
  lightning: 'electric',
  darkness: 'dark',
  metal: 'steel',
  colorless: 'normal',
};

/** The glyph and palette key for a Pokémon type or a TCG energy name. */
export function typeKey(type: string): string {
  const lower = type.toLowerCase();
  return ENERGY_ALIASES[lower] ?? lower;
}

export function TypeIcon({ type, active }: { type: string; active: boolean }) {
  const key = typeKey(type);
  const glyph = TYPE_GLYPHS[key] ?? TYPE_GLYPHS.normal;
  const color = `var(--color-type-${key})`;

  // Colour is how these glyphs are told apart — several are near-identical in silhouette at
  // 12px, and fire, fighting and psychic are only really distinguishable by hue. So the icon
  // stays coloured in both states and inverts instead: a coloured badge on the plain
  // unselected chip, and a white badge once the chip itself turns that colour, which would
  // otherwise swallow it.
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors"
      style={{ backgroundColor: active ? '#ffffff' : color }}
    >
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="currentColor"
        style={{ color: active ? color : '#ffffff' }}
      >
        {glyph}
      </svg>
    </span>
  );
}
