/**
 * The Pokémon type palette, and how to read it.
 *
 * Lives here rather than beside a component because it is not a component concern: the type
 * chips, the type glyphs, the grid tiles and the whole species page all colour themselves
 * from these values, so none of them owns it.
 */

// Keyed by Pokémon type name, but cards print the TCG's own energy types — same colours,
// different words. Only the four that disagree need mapping.
const ENERGY_ALIASES: Record<string, string> = {
  lightning: 'electric',
  darkness: 'dark',
  metal: 'steel',
  colorless: 'normal',
};

/** The glyph and palette key for a Pokémon type or a TCG energy name. */
export function typeKey(type: string): string {
  return ENERGY_ALIASES[type.toLowerCase()] ?? type.toLowerCase();
}

/** The CSS colour for a type, falling back to the house accent when there isn't one. */
export function typeColor(type: string | undefined | null): string {
  if (!type) return 'var(--color-accent)';
  return `var(--color-type-${typeKey(type)}, var(--color-accent))`;
}
