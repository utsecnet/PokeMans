import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  deleteCollectionBox,
  fetchCollectionBox,
  removeCollectionEntry,
  renameCollectionBox,
  setCollectionEntryQuantity,
  setCollectionEntryVariant,
} from '../lib/api';
import { useCollection } from '../lib/collectionContext';
import { CardLightbox } from '../components/CardLightbox';
import { collectionColorHex } from '../lib/collectionColors';
import type { CollectionBoxDetail } from '../types';
import { formatName } from '../lib/format';

export function CollectionBoxPage() {
  const { boxId } = useParams();
  const navigate = useNavigate();
  const { refresh } = useCollection();
  const [box, setBox] = useState<CollectionBoxDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState('');
  // Card id only — the card view loads the rest itself.
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = () => {
    if (!boxId) return;
    setLoading(true);
    fetchCollectionBox(Number(boxId))
      .then((data) => {
        setBox(data);
        setNameInput(data.name);
      })
      .catch((err) => console.error('Failed to load collection:', err))
      .finally(() => setLoading(false));
  };

  useEffect(load, [boxId]);

  const totalQuantity = box?.entries.reduce((sum, e) => sum + e.quantity, 0) ?? 0;

  // Setting a printing can merge this copy into one the box already holds, so the box is
  // reloaded rather than patched in place — the server decides what merged into what.
  const changeVariant = async (entryId: number, variantPosition: number | null) => {
    await setCollectionEntryVariant(entryId, variantPosition);
    load();
  };

  const adjustQuantity = async (entryId: number, delta: number) => {
    if (!box) return;
    const entry = box.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const nextQty = entry.quantity + delta;
    if (nextQty <= 0) {
      await removeCollectionEntry(entryId);
      setBox({ ...box, entries: box.entries.filter((e) => e.id !== entryId) });
    } else {
      await setCollectionEntryQuantity(entryId, nextQty);
      setBox({
        ...box,
        entries: box.entries.map((e) => (e.id === entryId ? { ...e, quantity: nextQty } : e)),
      });
    }
    refresh();
  };

  const removeEntry = async (entryId: number) => {
    if (!box) return;
    await removeCollectionEntry(entryId);
    setBox({ ...box, entries: box.entries.filter((e) => e.id !== entryId) });
    refresh();
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!box || !nameInput.trim() || nameInput.trim() === box.name) {
      setRenaming(false);
      return;
    }
    await renameCollectionBox(box.id, nameInput.trim());
    setBox({ ...box, name: nameInput.trim() });
    setRenaming(false);
    refresh();
  };

  const handleDelete = async () => {
    if (!box) return;
    if (!confirm(`Delete "${box.name}"? This removes all ${box.entries.length} card entries in it.`)) {
      return;
    }
    await deleteCollectionBox(box.id);
    refresh();
    navigate('/collection');
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 text-center text-[var(--color-text-muted)]">
        Loading…
      </div>
    );
  }

  if (!box) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 text-center">
        <p>Collection not found.</p>
        <Link to="/collection" className="text-[var(--color-accent)]">
          Back to My Collection
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link
        to="/collection"
        className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        ← My Collection
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {renaming ? (
          <form onSubmit={handleRename} className="flex items-center gap-2">
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={handleRename}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-2xl font-bold outline-none focus:border-[var(--color-accent)]"
            />
          </form>
        ) : (
          <div className="flex items-center gap-2">
            {collectionColorHex(box.color) && (
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: collectionColorHex(box.color) ?? undefined }}
              />
            )}
            <h1
              onClick={() => setRenaming(true)}
              title="Click to rename"
              className="cursor-pointer text-2xl font-bold"
            >
              {box.name}
            </h1>
          </div>
        )}
        <button
          type="button"
          onClick={handleDelete}
          className="text-sm text-red-600 hover:underline dark:text-red-400"
        >
          Delete collection
        </button>
      </div>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        {box.entries.length} card{box.entries.length === 1 ? '' : 's'}
        {totalQuantity !== box.entries.length ? ` · ${totalQuantity} total copies` : ''}
      </p>

      {box.entries.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-[var(--color-text-muted)]">
          This collection is empty. Add cards from any Pokémon's trading card gallery.
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {box.entries.map((entry) => (
          <div
            key={entry.id}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
          >
            {/* The card face opens the card view, as it does everywhere else; the Pokémon
                name below is still the way through to the Pokémon itself. */}
            {entry.imageSmall && (
              <button
                type="button"
                onClick={() => setLightbox(entry.cardId)}
                title={`View ${entry.name}`}
                className="block w-full"
              >
                <img src={entry.imageSmall} alt={entry.name} className="w-full rounded" />
              </button>
            )}
            <p className="mt-1 truncate text-xs font-medium">{entry.name}</p>
            <p className="truncate text-xs text-[var(--color-text-muted)]">
              {entry.setName}
              {entry.number ? ` #${entry.number}` : ''}
            </p>
            {entry.pokemonName && (
              <Link
                to={`/pokemon/${entry.pokemonId}`}
                className="truncate text-xs capitalize text-[var(--color-accent)]"
              >
                {formatName(entry.pokemonName)}
              </Link>
            )}

            {/* Which printing this copy is. Left unset by the quick-add flow, so it's
                offered here rather than in the way of filing a card. */}
            {/* The card's own printings, so a card that was never printed in reverse holo
                doesn't offer one. Vintage cards list each distinct print here — Unlimited,
                Shadowless, Shadowless 1st Edition — which can differ hugely in value. */}
            {entry.printings.length > 0 && (
              <select
                value={entry.variantPosition ?? ''}
                onChange={(e) =>
                  changeVariant(entry.id, e.target.value === '' ? null : Number(e.target.value))
                }
                aria-label={`Printing of ${entry.name}`}
                className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-xs text-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)]"
              >
                <option value="">Printing not set</option>
                {entry.printings.map((p) => (
                  <option key={p.position} value={p.position}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => adjustQuantity(entry.id, -1)}
                className="h-6 w-6 rounded border border-[var(--color-border)] text-sm"
              >
                −
              </button>
              <span className="text-sm font-semibold tabular-nums">{entry.quantity}</span>
              <button
                type="button"
                onClick={() => adjustQuantity(entry.id, 1)}
                className="h-6 w-6 rounded border border-[var(--color-border)] text-sm"
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={() => removeEntry(entry.id)}
              className="mt-1 w-full rounded border border-[var(--color-border)] py-1 text-xs text-red-600 hover:border-red-400 dark:text-red-400"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {lightbox && <CardLightbox cardId={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
