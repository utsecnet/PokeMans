export function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize tracking-wide text-white shadow-sm"
      style={{ backgroundColor: `var(--color-type-${type}, var(--color-text-muted))` }}
    >
      {type}
    </span>
  );
}
