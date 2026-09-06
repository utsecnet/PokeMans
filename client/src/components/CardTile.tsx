import { Link } from 'react-router-dom';
import type { CardListItem } from '../types';
import { formatName } from '../lib/format';
import { CardLocationBadge } from './CardLocationBadge';

export function CardTile({
  card,
  onImageClick,
  ringMode = null,
  activeMode = null,
  tapHint,
}: {
  card: CardListItem;
  onImageClick: () => void;
  ringMode?: 'add' | 'remove' | null;
  activeMode?: 'add' | 'remove' | null;
  tapHint?: string;
}) {
  return (
    <div className="group relative isolate rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 transition hover:-translate-y-0.5 hover:shadow-lg">
      <div
        role="button"
        tabIndex={0}
        onClick={onImageClick}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          onImageClick();
        }}
        title={tapHint ?? `${card.name} — ${card.setName ?? ''}${card.number ? ` #${card.number}` : ''}`}
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
        <p className="mt-1 truncate text-xs font-medium">{card.name}</p>
        <p className="truncate text-xs text-[var(--color-text-muted)]">
          {card.setName}
          {card.number ? ` #${card.number}` : ''}
        </p>
      </div>
      {/* Trainer and Energy cards have no Pokémon to link to — name what they are instead,
          so the line keeps its place in the tile rather than collapsing. */}
      {card.pokemonId != null && card.pokemonName ? (
        <Link
          to={`/pokemon/${card.pokemonId}`}
          className="truncate text-xs capitalize text-[var(--color-accent)] hover:underline"
        >
          {formatName(card.pokemonName)}
        </Link>
      ) : (
        <span className="truncate text-xs text-[var(--color-text-muted)]">{card.supertype ?? '—'}</span>
      )}
      <div>
        <CardLocationBadge inBoxes={card.inBoxes} />
      </div>

      {activeMode && (
        <button
          type="button"
          onClick={onImageClick}
          title={tapHint}
          className={`absolute right-1 top-1 z-10 flex h-6 min-w-6 items-center justify-center rounded-full border px-1 text-xs font-semibold shadow ${
            activeMode === 'remove'
              ? 'border-red-500 bg-red-500 text-white'
              : 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
          }`}
        >
          {activeMode === 'remove' ? '−' : '+'}
        </button>
      )}
    </div>
  );
}
