import { Link } from 'react-router-dom';
import type { PokemonSummary } from '../types';
import { TypeBadge } from './TypeBadge';
import { typeKey } from './TypeIcon';

/**
 * The glow behind the sprite on hover, in the Pokémon's own type colours.
 *
 * Two overlapping radial gradients rather than a hard split down the middle: a dual type is
 * two lights behind one subject, so the colours should meet and blend in the centre the way
 * real backlights do. A single type gets one centred light instead of two identical ones,
 * which would otherwise read as a slightly brighter band across the middle.
 */
function backlight(types: string[]): string {
  const color = (t: string) => `var(--color-type-${typeKey(t)})`;
  const [first, second] = types;
  if (!first) return 'transparent';
  if (!second)
    return `radial-gradient(closest-side at 50% 52%, ${color(first)} 0%, ${color(first)} 38%, transparent 78%)`;
  return (
    `radial-gradient(closest-side at 26% 52%, ${color(first)} 0%, ${color(first)} 34%, transparent 76%), ` +
    `radial-gradient(closest-side at 74% 52%, ${color(second)} 0%, ${color(second)} 34%, transparent 76%)`
  );
}

/**
 * The mote layers. Each is one grid of dots with its own spacing, drift speed and fade
 * rhythm; the tile sizes are co-prime so the grids never coincide and adjacent specks end up
 * on different layers, fading at unrelated times.
 *
 * Sizes are sub-pixel on purpose — a mote should be a hint that something is there, not a
 * dot you can point at.
 */
const SPECK_LAYERS = [
  { at: '30% 40%', r: 0.8, tile: '19px 16px', drift: '-16px', dur: '26s', tw: '3.1s', delay: '0s' },
  { at: '70% 15%', r: 0.7, tile: '26px 23px', drift: '-23px', dur: '34s', tw: '4.3s', delay: '1.1s' },
  { at: '15% 75%', r: 0.6, tile: '14px 31px', drift: '-31px', dur: '22s', tw: '2.7s', delay: '2s' },
  { at: '55% 62%', r: 0.75, tile: '31px 19px', drift: '-19px', dur: '30s', tw: '3.7s', delay: '0.6s' },
  { at: '85% 48%', r: 0.65, tile: '23px 27px', drift: '-27px', dur: '38s', tw: '5.1s', delay: '1.7s' },
] as const;

const SPECK_MASK = 'radial-gradient(closest-side at 50% 52%, #000 25%, #000 62%, transparent 92%)';

export function PokemonCard({ pokemon }: { pokemon: PokemonSummary }) {
  const image = pokemon.artworkUrl ?? pokemon.spriteUrl;

  return (
    <Link
      to={`/pokemon/${pokemon.id}`}
      className="group flex flex-col items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <span className="self-start font-mono text-xs text-[var(--color-text-muted)]">
        #{String(pokemon.nationalDexNumber).padStart(4, '0')}
      </span>
      <div className="relative flex h-28 w-28 items-center justify-center">
        {/* Sits behind the sprite and spills past the box, so the light appears to come from
            behind the Pokémon rather than to be a panel it is standing on. */}
        {pokemon.types.length > 0 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-6 rounded-full opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-90 motion-reduce:transition-none"
            style={{ background: backlight(pokemon.types) }}
          />
        )}
        {/* Above the glow, below the sprite. The mask reaches most of the way to the edge on
            purpose: pulled in tight, every speck landed under the sprite and none survived
            into the lit ring around it, which is the only place they are visible. */}
        {pokemon.types.length > 0 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-6 rounded-full opacity-0 transition-opacity duration-500 group-hover:opacity-100 motion-reduce:transition-none"
            style={{ maskImage: SPECK_MASK, WebkitMaskImage: SPECK_MASK }}
          >
            {/* Drift and twinkle live on the inner layers so neither fights the hover fade for
                the same opacity property, and both keep running while the card is idle —
                motes already in motion when the light comes up, rather than starting on cue. */}
            {SPECK_LAYERS.map((l) => (
              <span
                key={l.tile}
                className="speck-layer absolute inset-0"
                style={
                  {
                    backgroundImage: `radial-gradient(circle at ${l.at}, var(--color-speck) ${l.r}px, transparent ${l.r + 0.6}px)`,
                    backgroundSize: l.tile,
                    '--speck-drift': l.drift,
                    '--speck-drift-dur': l.dur,
                    '--speck-twinkle-dur': l.tw,
                    '--speck-twinkle-delay': l.delay,
                  } as React.CSSProperties
                }
              />
            ))}
          </span>
        )}
        {image ? (
          <img
            src={image}
            alt={pokemon.name}
            loading="lazy"
            className="relative h-full w-full object-contain transition group-hover:scale-105"
          />
        ) : (
          <div className="relative h-full w-full rounded-full bg-[var(--color-border)]" />
        )}
      </div>
      <h3 className="mt-1 capitalize text-[var(--color-text)]">
        {pokemon.name.replace(/-/g, ' ')}
        {/* How many cards exist for this Pokémon — omitted at zero rather than showing
            "(0)" on every Pokémon with no cards synced. */}
        {pokemon.cardCount > 0 && (
          <span
            className="ml-1 font-mono text-xs text-[var(--color-text-muted)]"
            title={`${pokemon.cardCount} card${pokemon.cardCount === 1 ? '' : 's'}`}
          >
            ({pokemon.cardCount})
          </span>
        )}
      </h3>
      <div className="mt-2 flex gap-1.5">
        {pokemon.types.map((t) => (
          <TypeBadge key={t} type={t} />
        ))}
      </div>
    </Link>
  );
}
