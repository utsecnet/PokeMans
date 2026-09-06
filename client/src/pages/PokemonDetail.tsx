import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchPokemonDetail } from '../lib/api';
import type { CollectionBoxRef, PokemonDetail as PokemonDetailType, TcgCard } from '../types';
import { TypeBadge } from '../components/TypeBadge';
import { StatBar } from '../components/StatBar';
import { EvolutionTree } from '../components/EvolutionTree';
import { AddToBoxRail } from '../components/AddToBoxRail';
import { CardLocationBadge } from '../components/CardLocationBadge';
import { CardLightbox } from '../components/CardLightbox';
import { useBoxTapMode } from '../lib/boxTapMode';
import { formatName } from '../lib/format';

const STAT_LABELS: Record<string, string> = {
  hp: 'HP',
  attack: 'Atk',
  defense: 'Def',
  specialAttack: 'SpA',
  specialDefense: 'SpD',
  speed: 'Spe',
};

function EvolutionChain({ pokemon }: { pokemon: PokemonDetailType }) {
  const chain = pokemon.evolutionChain;
  if (!chain) return null;
  const isSolo = chain.id === pokemon.id && chain.children.length === 0;
  if (isSolo) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">Evolution</h2>
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <EvolutionTree root={chain} currentId={pokemon.id} />
      </div>
    </section>
  );
}

function RegionalVariants({ pokemon }: { pokemon: PokemonDetailType }) {
  if (pokemon.variants.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">Regional Variants</h2>
      <div className="space-y-4">
        {pokemon.variants.map((variant) => {
          const chain = variant.evolutionChain;
          const hasChain = !!chain && (chain.id !== variant.id || chain.children.length > 0);
          const baseName = variant.name.split('-')[0];
          return (
            <div
              key={variant.id}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <Link to={`/pokemon/${variant.id}`} className="flex items-center gap-3">
                <img
                  src={variant.artworkUrl ?? variant.spriteUrl ?? undefined}
                  alt={variant.name}
                  className="h-16 w-16 object-contain"
                />
                <div>
                  {variant.variantLabel && (
                    <span className="text-xs font-medium text-[var(--color-accent)]">
                      {variant.variantLabel} Form
                    </span>
                  )}
                  <h3 className="font-semibold capitalize">{formatName(baseName)}</h3>
                  <div className="mt-1 flex gap-1.5">
                    {variant.types.map((t) => (
                      <TypeBadge key={t} type={t} />
                    ))}
                  </div>
                </div>
              </Link>
              {hasChain && chain && (
                <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                  <EvolutionTree root={chain} currentId={variant.id} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const CARD_PREVIEW_COUNT = 20;

type CardSort = 'release-asc' | 'release-desc' | 'set-name';

const CARD_SORT_OPTIONS: { value: CardSort; label: string }[] = [
  { value: 'release-asc', label: 'Oldest first' },
  { value: 'release-desc', label: 'Newest first' },
  { value: 'set-name', label: 'Expansion (A–Z)' },
];

function sortCards(cards: TcgCard[], sort: CardSort): TcgCard[] {
  const sorted = [...cards];
  if (sort === 'set-name') {
    sorted.sort((a, b) => (a.setName ?? '').localeCompare(b.setName ?? ''));
  } else {
    sorted.sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? ''));
    if (sort === 'release-desc') sorted.reverse();
  }
  return sorted;
}

export function PokemonDetail() {
  const { id } = useParams();
  const [pokemon, setPokemon] = useState<PokemonDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  // Holds the card's id: the card view fetches the rest itself, so this page doesn't need
  // the fuller card shape its own gallery query doesn't return.
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [showAllCards, setShowAllCards] = useState(false);
  const [cardSetFilter, setCardSetFilter] = useState('');
  const [cardSort, setCardSort] = useState<CardSort>('release-asc');
  const {
    activeBoxId,
    setActiveBoxId,
    railMode,
    setRailMode,
    actionCount,
    handleTap,
    ringModeFor,
    reset: resetBoxTapMode,
    activeBoxName,
  } = useBoxTapMode();

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setPokemon(null);
    setShowAllCards(false);
    setCardSetFilter('');
    setCardSort('release-asc');
    resetBoxTapMode();
    fetchPokemonDetail(id)
      .then(setPokemon)
      .catch((err) => console.error('Failed to load Pokémon detail:', err))
      .finally(() => setLoading(false));
  }, [id]);

  const updateCardCollection = (cardId: string, inBoxes: CollectionBoxRef[]) => {
    setPokemon((prev) =>
      prev
        ? {
            ...prev,
            tcgCards: prev.tcgCards.map((c) =>
              c.id === cardId
                ? { ...c, inBoxes, totalOwned: inBoxes.reduce((s, b) => s + b.quantity, 0) }
                : c,
            ),
          }
        : prev,
    );
  };

  // With a box selected in the rail, tapping a card face adds (or, in remove mode,
  // removes) a copy straight away instead of opening the lightbox — that's reserved for
  // plain browsing, when no box is active.
  const handleCardClick = (card: TcgCard) =>
    handleTap(
      card,
      (inBoxes) => updateCardCollection(card.id, inBoxes),
      () => setLightbox(card.id),
    );

  const cardSets = useMemo(() => {
    if (!pokemon) return [];
    const seen = new Map<string, string>();
    for (const card of pokemon.tcgCards) {
      if (card.setId && !seen.has(card.setId)) seen.set(card.setId, card.setName ?? card.setId);
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [pokemon]);

  const visibleCards = useMemo(() => {
    if (!pokemon) return [];
    const filtered = cardSetFilter
      ? pokemon.tcgCards.filter((c) => c.setId === cardSetFilter)
      : pokemon.tcgCards;
    return sortCards(filtered, cardSort);
  }, [pokemon, cardSetFilter, cardSort]);

  if (loading) {
    return <div className="mx-auto max-w-4xl px-4 py-10 text-center text-[var(--color-text-muted)]">Loading…</div>;
  }

  if (!pokemon) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 text-center">
        <p>Pokémon not found.</p>
        <Link to="/" className="text-[var(--color-accent)]">
          Back to PokéMans
        </Link>
      </div>
    );
  }

  const image = pokemon.artworkUrl ?? pokemon.spriteUrl;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
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

      <RegionalVariants pokemon={pokemon} />

      {pokemon.tcgCards.length > 0 && (
        <section className="mt-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            <AddToBoxRail
              activeBoxId={activeBoxId}
              onSelect={setActiveBoxId}
              mode={railMode}
              onModeChange={setRailMode}
              actionCount={actionCount}
              className="md:order-2"
            />

            <div className="min-w-0 flex-1">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">
                  Trading Cards ({visibleCards.length}
                  {visibleCards.length !== pokemon.tcgCards.length
                    ? ` of ${pokemon.tcgCards.length}`
                    : ''}
                  )
                </h2>
                <div className="flex gap-2">
                  <select
                    value={cardSetFilter}
                    onChange={(e) => {
                      setCardSetFilter(e.target.value);
                      setShowAllCards(false);
                    }}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
                  >
                    <option value="">All expansions</option>
                    {cardSets.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={cardSort}
                    onChange={(e) => setCardSort(e.target.value as CardSort)}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
                  >
                    {CARD_SORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {(showAllCards ? visibleCards : visibleCards.slice(0, CARD_PREVIEW_COUNT)).map(
                  (card) => {
                    const ringMode = ringModeFor(card);
                    const tapHint = activeBoxId
                      ? railMode === 'remove'
                        ? `Remove from ${activeBoxName}`
                        : `Add to ${activeBoxName}`
                      : `${card.name} — ${card.setName ?? ''}${card.number ? ` #${card.number}` : ''}`;
                    return (
                      <div
                        key={card.id}
                        className="group relative isolate rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => handleCardClick(card)}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            handleCardClick(card);
                          }}
                          title={tapHint}
                          className="cursor-pointer"
                        >
                          {card.imageSmall && (
                            <img
                              src={card.imageSmall}
                              alt={card.name}
                              className={`w-full rounded ${
                                ringMode === 'remove'
                                  ? 'ring-2 ring-inset ring-red-500'
                                  : ringMode === 'add'
                                    ? 'ring-2 ring-inset ring-[var(--color-accent)]'
                                    : ''
                              }`}
                              loading="lazy"
                            />
                          )}
                          <span className="mt-1 block truncate text-xs text-[var(--color-text-muted)]">
                            {card.setName}
                            {card.number ? ` #${card.number}` : ''}
                          </span>
                        </div>
                        <div>
                          <CardLocationBadge inBoxes={card.inBoxes} />
                        </div>

                        {activeBoxId && (
                          <button
                            type="button"
                            onClick={() => handleCardClick(card)}
                            title={tapHint}
                            className={`absolute right-1 top-1 z-10 flex h-6 min-w-6 items-center justify-center rounded-full border px-1 text-xs font-semibold shadow ${
                              railMode === 'remove'
                                ? 'border-red-500 bg-red-500 text-white'
                                : 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
                            }`}
                          >
                            {railMode === 'remove' ? '−' : '+'}
                          </button>
                        )}
                      </div>
                    );
                  },
                )}
              </div>
              {!showAllCards && visibleCards.length > CARD_PREVIEW_COUNT && (
                <button
                  type="button"
                  onClick={() => setShowAllCards(true)}
                  className="mt-3 text-sm text-[var(--color-accent)] underline"
                >
                  Show all {visibleCards.length} cards
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {lightbox && <CardLightbox cardId={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
