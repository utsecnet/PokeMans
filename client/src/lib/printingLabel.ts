/**
 * A stored printing, as something readable: "Holo · Shadowless · 1st Edition".
 *
 * Ported from server/src/lib/cardPricing.js rather than rewritten in SQL. It is
 * presentation, not data — Postgres returns the raw type, subtype and stamp, and this
 * turns them into words. Keeping it here also means the rule exists once, in the language
 * that already owns every other label in the app.
 */

const TYPE_LABELS: Record<string, string> = {
  normal: 'Normal',
  reverse: 'Reverse holo',
  holo: 'Holo',
  firstEdition: '1st Edition',
  wPromo: 'Promo',
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

export function printingLabel({ type, subtype, stamp }: PrintingRow): string {
  const parts = [TYPE_LABELS[type] ?? titleCase(type)];
  if (subtype) parts.push(titleCase(subtype));
  for (const s of String(stamp ?? '').split(',').filter(Boolean)) parts.push(titleCase(s));
  return parts.join(' · ');
}

/** Adds the readable label to each printing, in upstream order. */
export function withLabels<T extends PrintingRow>(printings: T[]): (T & { label: string })[] {
  return printings.map((p) => ({ ...p, label: printingLabel(p) }));
}
