import { useEffect, useRef, useState } from 'react';

export interface ColumnOption {
  key: string;
  label: string;
}

export function ColumnPicker({
  columns,
  visible,
  onChange,
}: {
  columns: ColumnOption[];
  visible: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = (key: string) => {
    onChange(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key]);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
      >
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 max-h-72 w-52 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm shadow-lg">
          {columns.map((col) => (
            <label
              key={col.key}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--color-bg)]"
            >
              <input
                type="checkbox"
                checked={visible.includes(col.key)}
                onChange={() => toggle(col.key)}
                className="accent-[var(--color-accent)]"
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
