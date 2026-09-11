/**
 * The Pokémon type palette, and how to read it.
 *
 * Lives here rather than beside the badge because it is not a component concern: the species
 * page tints its hero, its stat bars and its ability marks from the same values, so the badge
 * is one consumer of the palette rather than its owner.
 */

// The palette is keyed by Pokémon type name, but cards print the TCG's own energy types —
// same colours, different words. Only the four that disagree need mapping.
const PALETTE_KEY: Record<string, string> = {
  colorless: 'normal',
  lightning: 'electric',
  darkness: 'dark',
  metal: 'steel',
};

/** The CSS custom property for a type, falling back to the house accent when unknown. */
export function typeColor(type: string | undefined | null): string {
  if (!type) return 'var(--color-accent)';
  const key = PALETTE_KEY[type.toLowerCase()] ?? type.toLowerCase();
  return `var(--color-type-${key}, var(--color-accent))`;
}
