import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchPokemonDetail } from '../lib/api';
import type { PokemonDetail as PokemonDetailType } from '../types';
import { TypeBadge } from '../components/TypeBadge';
import { StatBar } from '../components/StatBar';

const STAT_LABELS: Record<string, string> = {
  hp: 'HP',
  attack: 'Atk',
  defense: 'Def',
  specialAttack: 'SpA',
  specialDefense: 'SpD',
  speed: 'Spe',
};

function formatName(name: string) {
  return name.replace(/-/g, ' ');
}

function EvolutionChain({ pokemon }: { pokemon: PokemonDetailType }) {
  if (pokemon.evolvesFrom.length === 0 && pokemon.evolvesTo.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">Evolution</h2>
      <div className="flex flex-wrap items-center gap-3">
        {pokemon.evolvesFrom.map((e) => (
          <div key={e.id} className="flex items-center gap-3">
            <Link to={`/pokemon/${e.id}`} className="flex flex-col items-center">
              <img src={e.spriteUrl ?? undefined} alt={e.name} className="h-16 w-16 object-contain" />
              <span className="text-xs capitalize">{formatName(e.name)}</span>
            </Link>
            <span className="text-[var(--color-text-muted)]">→</span>
          </div>
        ))}
        <div className="flex flex-col items-center">
          <img
            src={pokemon.spriteUrl ?? undefined}
            alt={pokemon.name}
            className="h-16 w-16 object-contain"
          />
          <span className="text-xs font-semibold capitalize">{formatName(pokemon.name)}</span>
        </div>
        {pokemon.evolvesTo.map((e) => (
          <div key={e.id} className="flex items-center gap-3">
            <span className="text-[var(--color-text-muted)]">→</span>
            <Link to={`/pokemon/${e.id}`} className="flex flex-col items-center">
              <img src={e.spriteUrl ?? undefined} alt={e.name} className="h-16 w-16 object-contain" />
              <span className="text-xs capitalize">{formatName(e.name)}</span>
              {e.minLevel && (
                <span className="text-[10px] text-[var(--color-text-muted)]">Lv. {e.minLevel}</span>
              )}
              {e.item && (
                <span className="text-[10px] capitalize text-[var(--color-text-muted)]">
                  {formatName(e.item)}
                </span>
              )}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PokemonDetail() {
  const { id } = useParams();
  const [pokemon, setPokemon] = useState<PokemonDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setPokemon(null);
    fetchPokemonDetail(id)
      .then(setPokemon)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="mx-auto max-w-4xl px-4 py-10 text-center text-[var(--color-text-muted)]">Loading…</div>;
  }

  if (!pokemon) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 text-center">
        <p>Pokémon not found.</p>
        <Link to="/" className="text-[var(--color-accent)]">
          Back to PokéDex
        </Link>
      </div>
    );
  }

  const image = pokemon.artworkUrl ?? pokemon.spriteUrl;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Link to="/" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        ← Back
      </Link>

      <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <div className="flex h-48 w-48 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)]">
          {image && <img src={image} alt={pokemon.name} className="h-40 w-40 object-contain" />}
        </div>

        <div className="flex-1">
          <span className="font-mono text-sm text-[var(--color-text-muted)]">
            #{String(pokemon.nationalDexNumber).padStart(4, '0')}
          </span>
          <h1 className="text-3xl font-bold capitalize">{formatName(pokemon.name)}</h1>
          <div className="mt-2 flex gap-2">
            {pokemon.types.map((t) => (
              <TypeBadge key={t} type={t} />
            ))}
          </div>
          {pokemon.flavorText && (
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">{pokemon.flavorText}</p>
          )}
          <div className="mt-3 flex gap-6 text-sm text-[var(--color-text-muted)]">
            {pokemon.height != null && <span>Height {pokemon.height / 10} m</span>}
            {pokemon.weight != null && <span>Weight {pokemon.weight / 10} kg</span>}
          </div>
        </div>
      </div>

      {pokemon.stats && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Base Stats</h2>
          <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            {(Object.keys(STAT_LABELS) as (keyof typeof STAT_LABELS)[]).map((key) => (
              <StatBar
                key={key}
                label={STAT_LABELS[key]}
                value={(pokemon.stats as unknown as Record<string, number>)[key] ?? 0}
              />
            ))}
          </div>
        </section>
      )}

      {pokemon.abilities.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Abilities</h2>
          <div className="flex flex-wrap gap-2">
            {pokemon.abilities.map((a) => (
              <span
                key={a.name}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm capitalize"
              >
                {formatName(a.name)}
                {a.isHidden && <span className="ml-1 text-xs text-[var(--color-text-muted)]">(hidden)</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      <EvolutionChain pokemon={pokemon} />

      {pokemon.tcgCards.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Trading Cards ({pokemon.tcgCards.length})</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {pokemon.tcgCards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => setLightbox(card.imageLarge ?? card.imageSmall)}
                className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
                title={`${card.name} — ${card.setName ?? ''}`}
              >
                {card.imageSmall && (
                  <img src={card.imageSmall} alt={card.name} className="w-full rounded" loading="lazy" />
                )}
                <span className="mt-1 block truncate text-xs text-[var(--color-text-muted)]">
                  {card.setName}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-xl shadow-2xl" />
        </div>
      )}
    </div>
  );
}
