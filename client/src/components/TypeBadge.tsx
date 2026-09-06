// The palette is keyed by Pokémon type name, but cards print the TCG's own energy types —
// same colours, different words. Only the four that disagree need mapping.
const PALETTE_KEY: Record<string, string> = {
  colorless: 'normal',
  lightning: 'electric',
  darkness: 'dark',
  metal: 'steel',
};

export function TypeBadge({ type }: { type: string }) {
  const key = PALETTE_KEY[type.toLowerCase()] ?? type.toLowerCase();
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize tracking-wide text-white shadow-sm"
      style={{ backgroundColor: `var(--color-type-${key}, var(--color-text-muted))` }}
    >
      {type}
    </span>
  );
}
