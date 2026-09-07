import { Link } from 'react-router-dom';
import type { CollectionBoxDetail } from '../types';
import { formatName } from '../lib/format';

/**
 * A collection as rows rather than tiles — the same controls as the tile view, laid out so a
 * large box can be read and edited without scrolling past card art.
 *
 * Deliberately no image column: the card face is what tile view is for, and a thumbnail per
 * row is what makes a long list slow to load and tall to scan.
 */
export function CollectionTable({
  entries,
  onOpenCard,
  onChangeQuantity,
  onChangeVariant,
  onRemove,
}: {
  entries: CollectionBoxDetail['entries'];
  onOpenCard: (cardId: string) => void;
  onChangeQuantity: (entryId: number, delta: number) => void;
  onChangeVariant: (entryId: number, position: number | null) => void;
  onRemove: (entryId: number) => void;
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
            <th className="px-3 py-2 text-left font-medium">Qty</th>
            <th className="px-3 py-2 text-left font-medium sr-only">Remove</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.id}
              className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface)]"
            >
              <td className="whitespace-nowrap px-3 py-1">
                <button
                  type="button"
                  onClick={() => onOpenCard(entry.cardId)}
                  title={`View ${entry.name}`}
                  className="text-left hover:text-[var(--color-accent)]"
                >
                  {entry.name}
                </button>
              </td>
              <td className="whitespace-nowrap px-3 py-1 text-[var(--color-text-muted)]">
                {entry.setName ?? '—'}
              </td>
              <td className="px-3 py-1 tabular-nums">{entry.number ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-1">
                {entry.pokemonName ? (
                  <Link
                    to={`/pokemon/${entry.pokemonId}`}
                    className="capitalize text-[var(--color-accent)] hover:underline"
                  >
                    {formatName(entry.pokemonName)}
                  </Link>
                ) : (
                  <span className="text-[var(--color-text-muted)]">—</span>
                )}
              </td>
              <td className="px-3 py-1">
                {entry.printings.length > 0 ? (
                  <select
                    value={entry.variantPosition ?? ''}
                    onChange={(e) =>
                      onChangeVariant(entry.id, e.target.value === '' ? null : Number(e.target.value))
                    }
                    aria-label={`Printing of ${entry.name}`}
                    className="max-w-[15rem] rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-xs outline-none focus:border-[var(--color-accent)]"
                  >
                    <option value="">Not set</option>
                    {entry.printings.map((p) => (
                      <option key={p.position} value={p.position}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-[var(--color-text-muted)]">—</span>
                )}
              </td>
              <td className="px-3 py-1">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onChangeQuantity(entry.id, -1)}
                    aria-label={`One fewer ${entry.name}`}
                    className="h-6 w-6 rounded border border-[var(--color-border)] text-sm"
                  >
                    −
                  </button>
                  <span className="w-5 text-center text-sm font-semibold tabular-nums">
                    {entry.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChangeQuantity(entry.id, 1)}
                    aria-label={`One more ${entry.name}`}
                    className="h-6 w-6 rounded border border-[var(--color-border)] text-sm"
                  >
                    +
                  </button>
                </div>
              </td>
              <td className="px-3 py-1">
                <button
                  type="button"
                  onClick={() => onRemove(entry.id)}
                  className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-red-600 hover:border-red-400 dark:text-red-400"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
