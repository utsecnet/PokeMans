import { useState, type ReactNode } from 'react';

export function MultiSelectFilter({
  options,
  selected,
  onChange,
  renderLabel,
  searchable = false,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  renderLabel?: (value: string) => ReactNode;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState('');
  const filtered = searchable
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <div>
      {searchable && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="mb-2 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
        />
      )}
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {filtered.map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={selected.includes(o)}
              onChange={() => toggle(o)}
              className="accent-[var(--color-accent)]"
            />
            <span className="truncate">{renderLabel ? renderLabel(o) : o}</span>
          </label>
        ))}
        {filtered.length === 0 && <p className="text-[var(--color-text-muted)]">No matches.</p>}
      </div>
      {selected.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="mt-2 text-[var(--color-accent)] underline"
        >
          Clear
        </button>
      )}
    </div>
  );
}
