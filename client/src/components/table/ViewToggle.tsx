export type ViewMode = 'tile' | 'table';

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-[var(--color-border)] text-sm">
      <button
        type="button"
        onClick={() => onChange('tile')}
        title="Tile view"
        className={`px-3 py-2 ${mode === 'tile' ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]' : 'bg-[var(--color-surface)]'}`}
      >
        ▦
      </button>
      <button
        type="button"
        onClick={() => onChange('table')}
        title="Table view"
        className={`px-3 py-2 ${mode === 'table' ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]' : 'bg-[var(--color-surface)]'}`}
      >
        ☰
      </button>
    </div>
  );
}
