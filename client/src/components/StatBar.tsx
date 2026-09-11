export function StatBar({
  label,
  value,
  max = 200,
  accent = "var(--color-accent)",
}: {
  label: string;
  value: number;
  max?: number;
  /** Bar colour. Defaults to the house accent; species pages pass their type colour. */
  accent?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="flex items-center gap-3">
      <span className="w-9 shrink-0 text-xs font-medium text-[var(--color-text-muted)]">
        {label}
      </span>
      <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums">{value}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-border)]">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct}%`, backgroundColor: accent }}
        />
      </div>
    </div>
  );
}
