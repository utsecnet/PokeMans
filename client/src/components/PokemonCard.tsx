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
