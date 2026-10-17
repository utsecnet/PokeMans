/**
 * A stored printing, as something readable: "Holo · Shadowless · 1st Edition".
 *
 * Ported from server/src/lib/cardPricing.js rather than rewritten in SQL. It is
 * presentation, not data — Postgres returns the raw type, subtype and stamp, and this
 * turns them into words. Keeping it here also means the rule exists once, in the language
 * that already owns every other label in the app.
 *
 * Every field the printing is keyed on appears in the label, which is the point: two
 * printings of one card that differ only in foil pattern or card size were both reading
 * "Reverse holo", and a label that cannot tell two rows apart is worse than no label —
 * a reader seeing two identical rows assumes a duplicate rather than a second printing.
 */

const TYPE_LABELS: Record<string, string> = {
  normal: 'Normal',
  reverse: 'Reverse holo',
  holo: 'Holo',
  firstEdition: '1st Edition',
  wPromo: 'Promo',
};

/**
 * The foil pattern pressed into the card, where the printing records one.
 *
 * Only the names titleCase would get wrong are listed — a ball foil is two words and the
 * stored value is one ("pokeball"), so it cannot be split mechanically. Anything else,
 * including a pattern added upstream after this was written, falls through to titleCase.
 */
const FOIL_LABELS: Record<string, string> = {
  pokeball: 'Poké Ball',
  masterball: 'Master Ball',
  duskball: 'Dusk Ball',
  loveball: 'Love Ball',
  friendball: 'Friend Ball',
  quickball: 'Quick Ball',
};

/**
 * Splits on separators, except one sitting between digits: "1999-2000-copyright" reads
 * "1999-2000 Copyright", not "1999 2000 Copyright".
 */
function titleCase(s: string): string {
  return String(s)
    .split(/(?<!\d)[-_]|[-_](?!\d)/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export interface PrintingRow {
  position: number;
  type: string;
  subtype?: string | null;
  stamp?: string | null;
  size?: string | null;
  foil?: string | null;
}

export function printingLabel({ type, subtype, stamp, size, foil }: PrintingRow): string {
  const parts = [TYPE_LABELS[type] ?? titleCase(type)];
  if (subtype) parts.push(titleCase(subtype));
  for (const s of String(stamp ?? '').split(',').filter(Boolean)) parts.push(titleCase(s));
  // "foil" names the pattern, not whether the card is foil at all, so it is said as a
  // material: a Poké Ball reverse and an energy-pattern reverse are different printings
  // and sell for different money.
  if (foil) parts.push(`${FOIL_LABELS[foil] ?? titleCase(foil)} foil`);
  // Standard is every card's size and says nothing; a jumbo is a different object.
  if (size && size !== 'standard') parts.push(titleCase(size));
  return parts.join(' · ');
}

/** Adds the readable label to each printing, in upstream order. */
export function withLabels<T extends PrintingRow>(printings: T[]): (T & { label: string })[] {
  return printings.map((p) => ({ ...p, label: printingLabel(p) }));
}
