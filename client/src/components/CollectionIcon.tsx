import { iconById } from './collectionIcons';

/**
 * The glyph standing for a collection, drawn as line art in the collection's own colour.
 *
 * An earlier version masked the expansion symbols shipped with the card data. Two things
 * killed it: those PNGs are filled artwork, so masking flattened them to solid silhouettes —
 * and most set symbols are a circle or a rounded rectangle, so a page of them was a page of
 * identical blobs. Strokes with no fill let the page background through and stay legible on
 * either theme, which a filled shape never manages on both.
 *
 * `icon` is stored as a plain id. Anything unrecognised falls back to the Poké Ball rather
 * than rendering nothing, so an icon retired later can't leave a collection blank.
 *
 * The 1.1 default is the weight the set was drawn and approved at, rendered at 40px. It is
 * deliberately light: heavier strokes closed up the gaps inside the denser glyphs (the
 * snowflake, the triple star) and turned them back into the blobs this set replaced.
 */
export function CollectionIcon({
  icon,
  color,
  className = 'h-10 w-10',
  strokeWidth = 1.1,
}: {
  icon: string | null | undefined;
  /** Resolved hex, or null to inherit currentColor. */
  color?: string | null;
  className?: string;
  strokeWidth?: number;
}) {
  const def = iconById(icon) ?? iconById('pokeball')!;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      style={color ? { color } : undefined}
    >
      {def.paths}
    </svg>
  );
}
