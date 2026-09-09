import { useId, useState } from 'react';

function PageButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40"
    >
      {label}
    </button>
  );
}

// Classic "delta window" truncation: always show the first and last page, a window of
// pages around the current one, and an ellipsis wherever there's a gap. With delta=2 this
// tops out at 9 numbered buttons (1, …, c-2..c+2, …, last) — comfortably under 10 even
// counting both ellipses.
function buildPageList(current: number, total: number, delta = 2): (number | 'ellipsis')[] {
  const windowStart = Math.max(2, current - delta);
  const windowEnd = Math.min(total - 1, current + delta);

  const pages: (number | 'ellipsis')[] = [1];

  // Only collapse into an ellipsis when it's actually hiding 2+ pages — hiding a single
  // page behind "…" takes the same space as just showing that page number, so there's no
  // reason to obscure it.
  if (windowStart > 3) {
    pages.push('ellipsis');
  } else {
    for (let i = 2; i < windowStart; i++) pages.push(i);
  }

  for (let i = windowStart; i <= windowEnd; i++) pages.push(i);

  if (windowEnd < total - 2) {
    pages.push('ellipsis');
  } else {
    for (let i = windowEnd + 1; i < total; i++) pages.push(i);
  }

  pages.push(total);
  return pages;
}

function JumpToPage({
  totalPages,
  onChange,
}: {
  totalPages: number;
  onChange: (page: number) => void;
}) {
  const [value, setValue] = useState('');
  // Generated, not a literal: the bar now renders twice on a page, and two inputs sharing
  // one id would point both labels at the first — clicking the bottom "Go to" would focus
  // the field at the top of the page.
  const inputId = useId();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return;
    onChange(Math.min(totalPages, Math.max(1, n)));
    setValue('');
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <label htmlFor={inputId} className="text-sm text-[var(--color-text-muted)]">
        Go to
      </label>
      <input
        id={inputId}
        type="number"
        min={1}
        max={totalPages}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="#"
        className="w-16 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-sm disabled:opacity-40"
      >
        Go
      </button>
    </form>
  );
}

export function Pagination({
  page,
  totalPages,
  onChange,
  compact = false,
  position = 'bottom',
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  // When true: cap visible page numbers at ~10 with an ellipsis for the gaps, and add a
  // jump-to-page field — needed once there are enough pages (hundreds, for the cards
  // browser) that listing every number would be unusable. Plain Pokémon-dex-sized
  // pagination keeps showing every page, unchanged.
  compact?: boolean;
  /**
   * Which end of the results this copy sits at. Only spacing differs — the bar above the
   * grid needs room beneath it rather than above, and the margin used to be baked in, which
   * left a gap between the filter bar and the page numbers when it moved to the top.
   */
  position?: 'top' | 'bottom';
}) {
  if (totalPages <= 1) return null;

  const pages = compact ? buildPageList(page, totalPages) : Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-3 ${
        position === 'top' ? 'mb-4' : 'mt-8'
      }`}
    >
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <PageButton label="Prev" onClick={() => onChange(page - 1)} disabled={page === 1} />
        {pages.map((p, i) =>
          p === 'ellipsis' ? (
            <span key={`e${i}`} className="px-1 text-sm text-[var(--color-text-muted)]">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              aria-current={p === page ? 'page' : undefined}
              className={`min-w-8 rounded-lg border px-2 py-1.5 text-sm tabular-nums transition ${
                p === page
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'
              }`}
            >
              {p}
            </button>
          ),
        )}
        <PageButton label="Next" onClick={() => onChange(page + 1)} disabled={page === totalPages} />
      </div>

      {compact && <JumpToPage totalPages={totalPages} onChange={onChange} />}
    </div>
  );
}
