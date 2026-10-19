import { Link } from 'react-router-dom';
import type { WantListDetail } from '../types';
import { formatName } from '../lib/format';
import { CardLocationBadge } from './CardLocationBadge';

type WantCard = WantListDetail['cards'][number];

/**
 * A want list as rows rather than tiles — the collection's table, with the columns a want
 * list actually has.
 *
 * No price column: what a card is worth is a question about a copy you own, and nothing
 * here is owned yet. In its place is Found, which is the only question a want list asks.
 * Printing is the same control the tile carries, and the reason it is in both is the issue
 * that asked for it: the table is where somebody works through a long list.
 *
 * Deliberately no image column, as in the collection. The card face is what tile view is
 * for, and a thumbnail per row is what makes a long list slow to load and tall to scan.
 */
export function WantTable({
  cards,
  onOpenCard,
  onChangeVariant,
  onRemove,
}: {
  cards: WantCard[];
  onOpenCard: (card: WantCard) => void;
  onChangeVariant: (entryId: number, position: number | null) => void;
  onRemove: (cardId: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
      <table className="w-full min-w-max text-sm">
        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface)] text-xs uppercase text-[var(--color-text-muted)]">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Name</th>
            <th className="px-3 py-2 text-left font-medium">Set</th>
            <th className="px-3 py-2 text-left font-medium">Number</th>
            <th className="px-3 py-2 text-left font-medium">Pokémon</th>
            <th className="px-3 py-2 text-left font-medium">Printing</th>
            <th className="px-3 py-2 text-left font-medium">Found</th>
            <th className="px-3 py-2 text-left font-medium sr-only">Remove</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => {
            const have = card.inBoxes.length > 0;
            return (
              <tr
                key={card.entryId}
                className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface)]"
              >
                <td className="whitespace-nowrap px-3 py-1">
                  <button
                    type="button"
                    onClick={() => onOpenCard(card)}
                    title={have ? `View ${card.name}` : `${card.name} — not in any collection`}
                    className={`text-left hover:text-[var(--color-accent)] ${
                      have ? '' : 'text-[var(--color-text-muted)]'
                    }`}
                  >
                    {card.name}
                  </button>
                </td>
                <td className="whitespace-nowrap px-3 py-1 text-[var(--color-text-muted)]">
                  {card.setName ?? '—'}
                </td>
                <td className="px-3 py-1 tabular-nums">{card.number ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-1">
                  {card.pokemonName ? (
                    <Link
                      to={`/pokemon/${card.pokemonId}`}
                      className="capitalize text-[var(--color-accent)] hover:underline"
                    >
                      {formatName(card.pokemonName)}
                    </Link>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">—</span>
                  )}
                </td>
                <td className="px-3 py-1">
                  {card.printings.length > 1 ? (
                    <select
                      value={card.variantPosition ?? ''}
                      onChange={(e) =>
                        onChangeVariant(
                          card.entryId,
                          e.target.value === '' ? null : Number(e.target.value),
                        )
                      }
                      aria-label={`Printing wanted of ${card.name}`}
                      className="max-w-[15rem] rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-xs outline-none focus:border-[var(--color-accent)]"
                    >
                      <option value="">Any printing</option>
                      {card.printings.map((p) => (
                        <option key={p.position} value={p.position}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-[var(--color-text-muted)]">—</span>
                  )}
                </td>
                {/* The badge draws nothing when a card is in no collection, which in a row
                    of columns would read as a rendering fault rather than as an answer. */}
                <td className="px-3 py-1">
                  {have ? (
                    <CardLocationBadge inBoxes={card.inBoxes} />
                  ) : (
                    <span className="text-xs text-[var(--color-text-muted)]">Still wanted</span>
                  )}
                </td>
                <td className="px-3 py-1">
                  <button
                    type="button"
                    onClick={() => onRemove(card.id)}
                    title="Remove from this want list"
                    className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-red-600 hover:border-red-400 dark:text-red-400"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
