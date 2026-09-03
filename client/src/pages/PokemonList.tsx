import { useEffect, useState } from 'react';
import { fetchGenerations, fetchPokemonList, fetchTypes } from '../lib/api';
import type { PokemonSummary } from '../types';
import { PokemonCard } from '../components/PokemonCard';

const PAGE_SIZE = 60;

function formatGeneration(gen: string) {
  return gen.replace('generation-', 'Gen ').toUpperCase();
}

export function PokemonList() {
  const [items, setItems] = useState<PokemonSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [type, setType] = useState('');
  const [generation, setGeneration] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [generations, setGenerations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTypes().then(setTypes).catch(() => {});
    fetchGenerations().then(setGenerations).catch(() => {});
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, type, generation]);

  useEffect(() => {
    setLoading(true);
    fetchPokemonList({ page, pageSize: PAGE_SIZE, search: debouncedSearch, type, generation })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, type, generation]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Pokémon..."
          className="flex-1 min-w-[200px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm capitalize outline-none"
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={generation}
          onChange={(e) => setGeneration(e.target.value)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none"
        >
          <option value="">All generations</option>
          {generations.map((g) => (
            <option key={g} value={g}>
              {formatGeneration(g)}
            </option>
          ))}
        </select>
      </div>

      {!loading && total === 0 && (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-[var(--color-text-muted)]">
          No Pokémon in the database yet. Run <code className="font-mono">npm run sync</code> in
          the server to pull data from PokeAPI.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items.map((p) => (
          <PokemonCard key={p.id} pokemon={p} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-sm text-[var(--color-text-muted)]">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
