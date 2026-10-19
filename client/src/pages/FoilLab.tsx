/**
 * The four foil treatments, side by side, for tuning them against real cards.
 *
 * This was a standalone page in client/public. It could not ship: it pulled the app's
 * stylesheet through Vite's ?direct, which only the dev server answers, so in production it
 * would have loaded unstyled. As a route it gets the real stylesheet for nothing, and it is
 * behind the admin check rather than behind nobody knowing the filename.
 *
 * It also dropped about ninety lines on the way in. The standalone page carried its own copy
 * of the pointer handling -- the same rAF, the same --tilt-x and --light-y custom properties
 * -- so the thing it was meant to preview was a reimplementation of the thing it was meant to
 * preview. Here it renders TiltCard, which is what the lightbox renders, so a change to the
 * foils shows up here without being copied here.
 */
import { Link } from 'react-router-dom';
import { TiltCard } from '../components/TiltCard';
import type { FoilKind } from '../components/RarityIcon';
import { localCardLarge } from '../lib/localImages';
import { useSession } from '../lib/sessionContext';

/**
 * What qualifies a card, read off foilFor() in RarityIcon.tsx.
 *
 * The rarity lists are every matching string actually present in the catalogue, not every
 * string the regex could match, and the counts are cards rather than printings.
 */
const KINDS: Record<FoilKind, {
  what: string;
  test: string;
  why: string;
  rarities: string;
  count: number;
}> = {
  cosmos: {
    what: 'WotC galaxy foil, illustration window only',
    test: 'rarity matches /rare/ AND released before 2003-07-01',
    why: 'The rarity string is the same "Rare Holo" either side of the handover, so only the date separates them. Nintendo took the licence in mid-2003 and the stock changed.',
    rarities: 'Rare Holo, Rare Shining, Rare Holo Star, …',
    count: 651,
  },
  stars: {
    what: 'modern stamped foil, whole face',
    test: 'rarity matches /rare/ AND released 2003-07-01 or later',
    why: 'The default for anything the catalogue marks with a single star.',
    rarities: 'Rare, Rare Holo, Holo Rare V / VMAX / VSTAR, Radiant Rare, Amazing Rare, ACE SPEC Rare, +22 more',
    count: 5156,
  },
  etch: {
    what: 'fine parallel lines, whole face',
    test: 'rarity matches /double|ultra|illustration|special/',
    why: 'Drawn with a double star in the sidebar. Their foil is etched in lines rather than stamped in shapes.',
    rarities: 'Double Rare, Illustration Rare, Special Illustration Rare, Rare Ultra, Ultra Rare, Shiny Ultra Rare',
    count: 2239,
  },
  sparkle: {
    what: 'dense glitter, edge to edge',
    test: 'rarity matches /hyper|secret|rainbow|crown/',
    why: 'Drawn with a crown. The whole card is foil, border included, not just the art.',
    rarities: 'Hyper Rare, Mega Hyper Rare, Rare Rainbow, Rare Secret',
    count: 733,
  },
};

const ORDER: FoilKind[] = ['cosmos', 'stars', 'etch', 'sparkle'];

/** One card per treatment, ids read out of the catalogue rather than typed from memory. */
const REAL: { id: string; kind: FoilKind; name: string; meta: string }[] = [
  { id: 'base1-1', kind: 'cosmos', name: 'Alakazam', meta: 'Base · Rare Holo · 1999' },
  { id: 'swsh12-66', kind: 'stars', name: 'Unown VSTAR', meta: 'Silver Tempest · Rare Holo VSTAR · 2022' },
  { id: 'me5-16', kind: 'etch', name: 'Wailord ex', meta: 'Pitch Black · Double Rare · 2026' },
  { id: 'me5-120', kind: 'sparkle', name: 'Mega Darkrai ex', meta: 'Pitch Black · Mega Hyper Rare · 2026' },
];

/** One card wearing every treatment in turn, so the material is the only thing that differs. */
const CONTROL = 'base1-4';

const TINT: Record<FoilKind, string> = {
  cosmos: 'text-sky-500 dark:text-sky-400',
  stars: 'text-amber-500 dark:text-amber-400',
  etch: 'text-violet-500 dark:text-violet-400',
  sparkle: 'text-rose-500 dark:text-rose-400',
};

export function FoilLab() {
  const { admin } = useSession();

  // Client-side only, and that is the honest extent of it: the bundle ships to everyone, so
  // this hides the page rather than protecting it. Acceptable because there is nothing here
  // but four pictures and the rules behind them -- no data, no request, nothing to call.
  if (!admin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-[var(--color-text-muted)]">Nothing here.</p>
        <Link to="/" className="mt-3 inline-block text-sm text-[var(--color-accent)] hover:underline">
          Back to the cards
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Foil Lab</h1>
        <Link to="/admin" className="text-sm text-[var(--color-accent)] hover:underline">
          Back to the admin panel
        </Link>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
        The four treatments on real cards and on one control card, drawn by the same component
        the lightbox uses. Move the pointer across a card to tilt it.
      </p>

      <h2 className="mt-8 text-lg font-semibold">One card, four materials</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Charizard wearing each in turn, so the foil is the only thing that changes.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
        {ORDER.map((kind) => (
          <Cell key={kind} src={localCardLarge(CONTROL)} kind={kind} name={kind} meta="control card" />
        ))}
      </div>

      <h2 className="mt-10 text-lg font-semibold">The card that actually qualifies</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Each treatment on a card the rules really pick it for.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
        {REAL.map((r) => (
          <Cell key={r.id} src={localCardLarge(r.id)} kind={r.kind} name={r.name} meta={r.meta} />
        ))}
      </div>

      <h2 className="mt-10 text-lg font-semibold">What earns each one</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {ORDER.map((kind) => {
          const d = KINDS[kind];
          return (
            <section
              key={kind}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className={`text-base font-semibold ${TINT[kind]}`}>{kind}</h3>
                <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
                  {d.count.toLocaleString()} cards
                </span>
              </div>
              <p className="mt-1 text-sm">{d.what}</p>
              <p className="mt-2 font-mono text-xs text-[var(--color-text-muted)]">{d.test}</p>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">{d.why}</p>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">{d.rarities}</p>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Cell({
  src,
  kind,
  name,
  meta,
}: {
  src: string | null;
  kind: FoilKind;
  name: string;
  meta: string;
}) {
  return (
    <figure className="min-w-0">
      {src && <TiltCard src={src} alt={name} foil={kind} className="w-full" />}
      <figcaption className="mt-2">
        <span className={`block truncate text-sm font-medium ${TINT[kind]}`}>{name}</span>
        <span className="block truncate text-xs text-[var(--color-text-muted)]">{meta}</span>
      </figcaption>
    </figure>
  );
}
