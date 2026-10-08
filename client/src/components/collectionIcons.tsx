import type { ReactNode } from 'react';

/**
 * Line icons for collections, drawn here rather than fetched.
 *
 * The expansion symbols this replaced came from the card dataset as filled PNGs. Masking
 * them gave a solid silhouette, and most set symbols are a circle or a rounded rectangle, so
 * the result was a page of indistinguishable blobs. These are strokes with no fill, so the
 * page background shows through and they read the same on light and dark.
 *
 * Every one is a 24x24 box drawn with `stroke="currentColor"` and `fill="none"`, so the
 * collection's colour is the only colour involved. Nothing here uses a fill except the
 * couple of dots that are meant to be solid — noted where they appear.
 */
export interface CollectionIconDef {
  id: string;
  label: string;
  group: 'Balls' | 'Storage' | 'Types' | 'Rarity' | 'Marks';
  paths: ReactNode;
}

export const COLLECTION_ICONS: CollectionIconDef[] = [
  // ---------------------------------------------------------------- Balls
  {
    id: 'pokeball',
    label: 'Poké Ball',
    group: 'Balls',
    paths: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h6m6 0h6" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  {
    id: 'greatball',
    label: 'Great Ball',
    group: 'Balls',
    paths: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h6m6 0h6" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6.6 5.6 9 9M17.4 5.6 15 9" />
      </>
    ),
  },
  {
    id: 'ultraball',
    label: 'Ultra Ball',
    group: 'Balls',
    paths: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h6m6 0h6" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M8 4.6v4M16 4.6v4M8 6.6h8" />
      </>
    ),
  },
  {
    id: 'masterball',
    label: 'Master Ball',
    group: 'Balls',
    paths: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h6m6 0h6" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M7.5 8.5V5l2 2 2-2v3.5" />
        <circle cx="16.5" cy="6.5" r="1.2" />
      </>
    ),
  },
  {
    id: 'premierball',
    label: 'Premier Ball',
    group: 'Balls',
    paths: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h6m6 0h6" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M12 3v2" />
      </>
    ),
  },
  {
    id: 'ball-open',
    label: 'Open Ball',
    group: 'Balls',
    paths: (
      <>
        <path d="M3.5 10.5a8.5 8.5 0 0 1 17 0" />
        <path d="M3.5 13.5a8.5 8.5 0 0 0 17 0" />
        <path d="M3.5 10.5h6m5 0h6M3.5 13.5h6m5 0h6" />
        <circle cx="12" cy="12" r="2.2" />
      </>
    ),
  },

  // ---------------------------------------------------------------- Storage
  {
    id: 'card',
    label: 'Card',
    group: 'Storage',
    paths: (
      <>
        <rect x="6" y="3" width="12" height="18" rx="2" />
        <rect x="8.5" y="6" width="7" height="6" rx="1" />
        <path d="M8.5 15h7M8.5 17.5h4" />
      </>
    ),
  },
  {
    id: 'cards',
    label: 'Card stack',
    group: 'Storage',
    paths: (
      <>
        <rect x="8" y="5" width="11" height="16" rx="2" />
        <path d="M15.5 2.5H7a2 2 0 0 0-2 2V17" />
      </>
    ),
  },
  {
    id: 'binder',
    label: 'Binder',
    group: 'Storage',
    paths: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M9 3v18" />
        <path d="M6.2 7.5h.01M6.2 12h.01M6.2 16.5h.01" />
      </>
    ),
  },
  {
    id: 'pack',
    label: 'Booster pack',
    group: 'Storage',
    paths: (
      <>
        <path d="M6 6h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
        <path d="M6 6l1.5-2 1.5 2 1.5-2 1.5 2 1.5-2 1.5 2 1.5-2L18 6" />
        <path d="M9 11h6" />
      </>
    ),
  },
  {
    id: 'deckbox',
    label: 'Deck box',
    group: 'Storage',
    paths: (
      <>
        <path d="M4 9l8-4 8 4v8l-8 4-8-4z" />
        <path d="M4 9l8 4 8-4M12 13v8" />
      </>
    ),
  },
  {
    id: 'sleeve',
    label: 'Sleeve',
    group: 'Storage',
    paths: (
      <>
        <path d="M6 3h12v18H6z" />
        <path d="M9 3v3a3 3 0 0 0 6 0V3" />
      </>
    ),
  },
  {
    id: 'pokedex',
    label: 'Pokédex',
    group: 'Storage',
    paths: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <circle cx="8" cy="7.5" r="2" />
        <path d="M13 6.5h.01M15.5 6.5h.01M18 6.5h.01" />
        <rect x="7" y="12" width="10" height="6" rx="1" />
      </>
    ),
  },
  {
    id: 'bag',
    label: 'Bag',
    group: 'Storage',
    paths: (
      <>
        <path d="M5 8h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </>
    ),
  },

  // ---------------------------------------------------------------- Types
  {
    id: 'fire',
    label: 'Fire',
    group: 'Types',
    paths: (
      <>
        <path d="M12 3c3.5 4 6 6.5 6 10a6 6 0 0 1-12 0c0-2 1-3.5 2.5-5 .3 1.4 1 2 1.8 2.2C10 8 10.5 5.5 12 3z" />
      </>
    ),
  },
  {
    id: 'water',
    label: 'Water',
    group: 'Types',
    paths: <path d="M12 3.5c3.2 4 6 7 6 10.2A6 6 0 0 1 6 13.7c0-3.2 2.8-6.2 6-10.2z" />,
  },
  {
    id: 'grass',
    label: 'Grass',
    group: 'Types',
    paths: (
      <>
        <path d="M5 19c0-7 4.5-12 14-13 .5 8-4 13-11 13z" />
        <path d="M9 15c2-2.5 4.5-4 8-5.5" />
      </>
    ),
  },
  {
    id: 'lightning',
    label: 'Lightning',
    group: 'Types',
    paths: <path d="M13.5 2.5 5.5 13.5h5l-1 8 8-11h-5z" />,
  },
  {
    id: 'psychic',
    label: 'Psychic',
    group: 'Types',
    paths: (
      <>
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
  },
  {
    id: 'fighting',
    label: 'Fighting',
    group: 'Types',
    // The overlapping knuckle arcs of the first attempt collapsed into a blob at 40px; a
    // plain rounded body with four separate arcs above it reads as a fist at any size.
    paths: (
      <>
        <rect x="5.5" y="9" width="13" height="9.5" rx="3" />
        <path d="M8.6 9V7.2a1.6 1.6 0 0 1 3.2 0V9" />
        <path d="M11.8 9V6.6a1.6 1.6 0 0 1 3.2 0V9" />
        <path d="M15 9V7.7a1.6 1.6 0 0 1 3.2 0V9" />
        <path d="M5.5 13.4h3.4" />
      </>
    ),
  },
  {
    id: 'darkness',
    label: 'Darkness',
    group: 'Types',
    paths: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  },
  {
    id: 'metal',
    label: 'Metal',
    group: 'Types',
    // A spoked circle read as a sun rather than a gear, so this is a hex nut instead —
    // unambiguously metal, and it survives being drawn at 20px.
    paths: (
      <>
        <path d="M12 2.6 20 7.3v9.4L12 21.4 4 16.7V7.3z" />
        <circle cx="12" cy="12" r="3.2" />
      </>
    ),
  },
  {
    id: 'fairy',
    label: 'Fairy',
    group: 'Types',
    paths: (
      <>
        <path d="M12 2.5c1 5 3.5 7.5 8.5 8.5-5 1-7.5 3.5-8.5 8.5-1-5-3.5-7.5-8.5-8.5 5-1 7.5-3.5 8.5-8.5z" />
      </>
    ),
  },
  {
    id: 'dragon',
    label: 'Dragon',
    group: 'Types',
    paths: (
      <>
        <path d="M5 4c1.5 5 4 8.5 8 10.5" />
        <path d="M9.5 3.5c.5 5 2.5 8.5 6 11" />
        <path d="M14.5 4.5c-.5 4.5.5 8 4 11" />
        <path d="M4.5 19.5c4 1.5 11 1.5 15-1.5" />
      </>
    ),
  },

  {
    id: 'normal',
    label: 'Normal / Colorless',
    group: 'Types',
    paths: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="4" />
      </>
    ),
  },
  {
    id: 'ice',
    label: 'Ice',
    group: 'Types',
    paths: (
      <>
        <path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2 3.8 16.8" />
        <path d="M12 5.6 9.8 4M12 5.6 14.2 4M12 18.4l-2.2 1.6M12 18.4l2.2 1.6" />
        <path d="M6.4 8.7 5.9 6.2M6.4 8.7 4 9.2M17.6 15.3l.5 2.5M17.6 15.3l2.4-.5" />
        <path d="M17.6 8.7 20 9.2M17.6 8.7l.5-2.5M6.4 15.3 4 14.8M6.4 15.3l-.5 2.5" />
      </>
    ),
  },
  {
    id: 'poison',
    label: 'Poison',
    group: 'Types',
    paths: (
      <>
        <path d="M11 20.5a6 6 0 0 1-2.6-11.4C9.6 8.5 10.2 7 10 5c2.2.6 3.8 2.2 4.4 4.2A6 6 0 0 1 11 20.5z" />
        <circle cx="17" cy="6.5" r="2" />
        <circle cx="19.2" cy="11.5" r="1.2" />
      </>
    ),
  },
  {
    id: 'ground',
    label: 'Ground',
    group: 'Types',
    paths: (
      <>
        <path d="M3 18h18" />
        <path d="M5.5 18c0-4.6 2.9-8 6.5-8s6.5 3.4 6.5 8" />
        <path d="M8.5 18c0-2.6 1.6-4.6 3.5-4.6s3.5 2 3.5 4.6" />
        <path d="M2.5 21h19" />
      </>
    ),
  },
  {
    id: 'flying',
    label: 'Flying',
    group: 'Types',
    paths: (
      <>
        <path d="M2.5 15.5c5.5-7.5 11.5-9.5 19-8.5-6.5 2.2-10.5 6.2-12.5 11.5-2-2.2-4.5-3-6.5-3z" />
        <path d="M6 14.5c3-3 6.5-4.8 11-5.8" />
      </>
    ),
  },
  {
    id: 'bug',
    label: 'Bug',
    group: 'Types',
    paths: (
      <>
        <ellipse cx="12" cy="13.5" rx="4.5" ry="6.5" />
        <path d="M12 7v13M7.5 13.5H3.5M16.5 13.5h4M8 9 4.5 6.5M16 9l3.5-2.5M8 18l-3.5 2.5M16 18l3.5 2.5" />
        <path d="M10 6.5 8.5 3.5M14 6.5 15.5 3.5" />
      </>
    ),
  },
  {
    id: 'rock',
    label: 'Rock',
    group: 'Types',
    paths: (
      <>
        <path d="M2.5 19 6.5 9l4 5.5L14 6l4.5 6.5L21.5 19z" />
        <path d="M6.5 9 10.5 14.5 14 6" />
      </>
    ),
  },
  {
    id: 'ghost',
    label: 'Ghost',
    group: 'Types',
    paths: (
      <>
        <path d="M5.5 20.5V11a6.5 6.5 0 0 1 13 0v9.5l-2.2-1.7-2.2 1.7-2.1-1.7-2.2 1.7z" />
        <path d="M9.8 10.5h.01M14.2 10.5h.01" />
      </>
    ),
  },

  // ---------------------------------------------------------------- Rarity
  {
    id: 'rarity-common',
    label: 'Common',
    group: 'Rarity',
    paths: <circle cx="12" cy="12" r="4.5" />,
  },
  {
    id: 'rarity-uncommon',
    label: 'Uncommon',
    group: 'Rarity',
    paths: <path d="M12 5.5 18.5 12 12 18.5 5.5 12z" />,
  },
  {
    id: 'star',
    label: 'Rare',
    group: 'Rarity',
    paths: <path d="M12 3.5 14.6 9.4 21 10.2 16.3 14.5 17.6 21 12 17.8 6.4 21 7.7 14.5 3 10.2 9.4 9.4z" />,
  },
  {
    id: 'double-star',
    label: 'Double Rare',
    group: 'Rarity',
    paths: (
      <>
        <path d="M8 4.5 9.9 8.8 14.5 9.4 11.1 12.5 12 17 8 14.7 4 17 4.9 12.5 1.5 9.4 6.1 8.8z" />
        <path d="M17 9.5 18.3 12.4 21.5 12.8 19.1 14.9 19.8 18 17 16.4 14.2 18l.7-3.1-2.4-2.1 3.2-.4z" />
      </>
    ),
  },
  {
    id: 'triple-star',
    label: 'Ultra Rare',
    group: 'Rarity',
    paths: (
      <>
        <path d="M6.5 3.5 7.8 6.4 11 6.8 8.6 8.9l.7 3.1-2.8-1.6-2.8 1.6.7-3.1L1.9 6.8l3.3-.4z" />
        <path d="M17.5 3.5l1.3 2.9 3.2.4-2.4 2.1.7 3.1-2.8-1.6-2.8 1.6.7-3.1-2.4-2.1 3.2-.4z" />
        <path d="M12 12.5l1.6 3.6 3.9.5-2.9 2.6.8 3.8-3.4-2-3.4 2 .8-3.8-2.9-2.6 3.9-.5z" />
      </>
    ),
  },
  {
    id: 'crown',
    label: 'Hyper / Secret Rare',
    group: 'Rarity',
    paths: (
      <>
        <path d="M3 8.5 6.5 13 12 5.5 17.5 13 21 8.5V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      </>
    ),
  },
  {
    id: 'illustration-rare',
    label: 'Illustration Rare',
    group: 'Rarity',
    paths: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M12 7.5 13.4 11 17 11.4l-2.7 2.3.8 3.5-3.1-1.8-3.1 1.8.8-3.5L7 11.4 10.6 11z" />
      </>
    ),
  },
  {
    id: 'special-illustration',
    label: 'Special Illustration Rare',
    group: 'Rarity',
    paths: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9.5 7.5 10.7 10.3 13.6 10.6l-2.2 1.9.7 2.9-2.6-1.5-2.6 1.5.7-2.9-2.2-1.9 2.9-.3z" />
        <path d="M16.5 12 17.4 14 19.6 14.3l-1.6 1.4.5 2.2-2-1.2-2 1.2.5-2.2-1.6-1.4 2.2-.3z" />
      </>
    ),
  },
  {
    id: 'promo-star',
    label: 'Promo',
    group: 'Rarity',
    paths: (
      <>
        <path d="M12 2.8 14.7 8.9 21.4 9.7 16.4 14.2 17.8 20.9 12 17.5 6.2 20.9 7.6 14.2 2.6 9.7 9.3 8.9z" />
        <path d="M12 8.4 12.9 10.6 15.3 10.9 13.5 12.5 14 14.9 12 13.7 10 14.9l.5-2.4-1.8-1.6 2.4-.3z" />
      </>
    ),
  },
  {
    id: 'shiny-star',
    label: 'Shiny Rare',
    group: 'Rarity',
    paths: (
      <>
        <path d="M11 6.5 12.8 10.4 17 11 14 13.9l.8 4.2L11 16.1 7.2 18.1 8 13.9 5 11l4.2-.6z" />
        <path d="M18.5 3.5c.3 1.6.9 2.2 2.5 2.5-1.6.3-2.2.9-2.5 2.5-.3-1.6-.9-2.2-2.5-2.5 1.6-.3 2.2-.9 2.5-2.5z" />
        <path d="M19.5 14.5c.2 1 .6 1.4 1.6 1.6-1 .2-1.4.6-1.6 1.6-.2-1-.6-1.4-1.6-1.6 1-.2 1.4-.6 1.6-1.6z" />
      </>
    ),
  },
  {
    id: 'ace-spec',
    label: 'ACE SPEC',
    group: 'Rarity',
    paths: (
      <>
        <path d="M12 2.8 20 5.6v6.6c0 4.4-3.3 7.6-8 8.9-4.7-1.3-8-4.5-8-8.9V5.6z" />
        <path d="M12 8 13.2 11.2 16.6 11.4 14 13.6l.8 3.3L12 15.1 9.2 16.9l.8-3.3-2.6-2.2 3.4-.2z" />
      </>
    ),
  },
  {
    id: 'radiant',
    label: 'Radiant Rare',
    group: 'Rarity',
    paths: (
      <>
        <path d="M12 6.5 13.5 10.5 17.5 12 13.5 13.5 12 17.5 10.5 13.5 6.5 12l4-1.5z" />
        <path d="M12 2v2.2M12 19.8V22M22 12h-2.2M4.2 12H2M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6M19.1 19.1l-1.6-1.6M6.5 6.5 4.9 4.9" />
      </>
    ),
  },
  {
    id: 'amazing-rare',
    label: 'Amazing Rare',
    group: 'Rarity',
    paths: (
      <>
        <path d="M12 5.5 14 10.3 19.2 10.8 15.3 14.2 16.4 19.3 12 16.6 7.6 19.3l1.1-5.1L4.8 10.8 10 10.3z" />
        <path d="M3 3.5l2 2M21 3.5l-2 2M2.5 12H4M20 12h1.5" />
      </>
    ),
  },
  {
    id: 'prism-star',
    label: 'Prism Star',
    group: 'Rarity',
    paths: (
      <>
        <path d="M12 3.5 21 19H3z" />
        <path d="M12 8.5 13.2 12 16.8 12.2 14 14.4l.9 3.5-2.9-1.9-2.9 1.9.9-3.5-2.8-2.2 3.6-.2z" />
      </>
    ),
  },
  {
    id: 'legend',
    label: 'LEGEND',
    group: 'Rarity',
    paths: (
      <>
        <rect x="3" y="4" width="18" height="7" rx="1.5" />
        <rect x="3" y="13" width="18" height="7" rx="1.5" />
        <path d="M8 11v2M16 11v2" />
      </>
    ),
  },
  {
    id: 'rainbow-rare',
    label: 'Rainbow Rare',
    group: 'Rarity',
    paths: (
      <>
        <path d="M3 18a9 9 0 0 1 18 0" />
        <path d="M6 18a6 6 0 0 1 12 0" />
        <path d="M9 18a3 3 0 0 1 6 0" />
      </>
    ),
  },
  {
    id: 'mega-rare',
    label: 'Mega Rare',
    group: 'Rarity',
    paths: (
      <>
        <path d="M3.5 19V6.5l4.2 5.5 4.3-5.5 4.3 5.5 4.2-5.5V19" />
        <path d="M12 20.2c.2 1 .7 1.5 1.7 1.7-1 .2-1.5.7-1.7 1.7-.2-1-.7-1.5-1.7-1.7 1-.2 1.5-.7 1.7-1.7z" />
      </>
    ),
  },
  {
    id: 'trainer-gallery',
    label: 'Trainer Gallery',
    group: 'Rarity',
    paths: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <circle cx="12" cy="10" r="2.8" />
        <path d="M7 18.5a5.5 5.5 0 0 1 10 0" />
      </>
    ),
  },

  // ---------------------------------------------------------------- Marks
  {
    id: 'trophy',
    label: 'Trophy',
    group: 'Marks',
    paths: (
      <>
        <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
        <path d="M7 5.5H4.5V8a3 3 0 0 0 3 3M17 5.5h2.5V8a3 3 0 0 1-3 3" />
        <path d="M12 14v3M9 20h6l-.5-3h-5z" />
      </>
    ),
  },
  {
    id: 'badge',
    label: 'Gym badge',
    group: 'Marks',
    paths: (
      <>
        <path d="M12 3l2.6 1.6 3-.2.9 2.9 2.3 2-1.6 2.6.5 3-2.9 1-1.9 2.3-2.9-.8-2.9.8-1.9-2.3-2.9-1 .5-3L3.2 9.3l2.3-2 .9-2.9 3 .2z" />
      </>
    ),
  },
  {
    id: 'egg',
    label: 'Egg',
    group: 'Marks',
    paths: (
      <>
        <path d="M12 3c3.5 0 6.5 5.5 6.5 10a6.5 6.5 0 0 1-13 0C5.5 8.5 8.5 3 12 3z" />
        <path d="M6.5 13.5 9 11.5l2 2 2-2 2 2 2.2-1.7" />
      </>
    ),
  },
  {
    id: 'berry',
    label: 'Berry',
    group: 'Marks',
    paths: (
      <>
        <circle cx="12" cy="14.5" r="6" />
        <path d="M12 8.5V5M12 5c-1.5-1.5-3.5-1.8-5-1 .3 1.8 1.8 3.3 3.6 3.6M12 5c1.5-1.5 3.5-1.8 5-1-.3 1.8-1.8 3.3-3.6 3.6" />
      </>
    ),
  },
  {
    id: 'potion',
    label: 'Potion',
    group: 'Marks',
    paths: (
      <>
        <path d="M10 3h4v4l3.2 4.6A4 4 0 0 1 14 18h-4a4 4 0 0 1-3.2-6.4L10 7z" />
        <path d="M7.5 13h9" />
      </>
    ),
  },
  {
    id: 'map',
    label: 'Route marker',
    group: 'Marks',
    paths: (
      <>
        <path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
  },
  {
    id: 'heart',
    label: 'Favourite',
    group: 'Marks',
    paths: (
      <path d="M12 20s-7.5-4.7-7.5-9.8A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.8C19.5 15.3 12 20 12 20z" />
    ),
  },
];

export function iconById(id: string | null | undefined): CollectionIconDef | null {
  if (!id) return null;
  return COLLECTION_ICONS.find((i) => i.id === id) ?? null;
}
