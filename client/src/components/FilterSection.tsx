import { useState, type ReactNode } from 'react';

export function FilterSection({
  title,
  badge,
  children,
  defaultOpen = false,
}: {
  title: string;
  badge?: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[var(--color-border)] pb-3 last:border-b-0 last:pb-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between py-1 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          {title}
          {!!badge && (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-semibold text-[var(--color-accent-contrast)]">
              {badge}
            </span>
          )}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={`h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
