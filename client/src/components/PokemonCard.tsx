import { Link } from 'react-router-dom';
import type { PokemonSummary } from '../types';
import { TypeBadge } from './TypeBadge';

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
      <div className="flex h-28 w-28 items-center justify-center">
        {image ? (
          <img
            src={image}
            alt={pokemon.name}
            loading="lazy"
            className="h-full w-full object-contain transition group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full rounded-full bg-[var(--color-border)]" />
        )}
      </div>
      <h3 className="mt-1 capitalize text-[var(--color-text)]">
        {pokemon.name.replace(/-/g, ' ')}
      </h3>
      <div className="mt-2 flex gap-1.5">
        {pokemon.types.map((t) => (
          <TypeBadge key={t} type={t} />
        ))}
      </div>
    </Link>
  );
}
