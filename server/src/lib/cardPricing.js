import { all, get } from '../db/index.js';

const TYPE_LABELS = {
  normal: 'Normal',
  reverse: 'Reverse holo',
  holo: 'Holo',
  firstEdition: '1st Edition',
  wPromo: 'Promo',
};

/** Turns a stored printing row into something readable: "Holo · Shadowless · 1st Edition". */
export function printingLabel({ type, subtype, stamp }) {
  // Split on separators, but not one sitting between digits — "1999-2000-copyright" should
  // read "1999-2000 Copyright", not "1999 2000 Copyright".
  const titleCase = (s) =>
    String(s)
      .split(/(?<!\d)[-_]|[-_](?!\d)/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  const parts = [TYPE_LABELS[type] ?? titleCase(type)];
  if (subtype) parts.push(titleCase(subtype));
  for (const s of String(stamp ?? '').split(',').filter(Boolean)) parts.push(titleCase(s));
  return parts.join(' · ');
}

/** The stored printings for a card, in upstream order. */
export function printingsFor(cardId) {
  return all(
    `SELECT position, type, subtype, stamp, size, foil FROM tcg_card_variants
     WHERE card_id = @id ORDER BY position`,
    { id: cardId },
  ).map((p) => ({ ...p, label: printingLabel(p) }));
}

// Prices come from TCGdex's per-card REST endpoint. There is no bulk equivalent — their
// GraphQL schema exposes no pricing field at all — so this is one request per card, which
// is why the daily job only ever walks the cards the user actually owns rather than the
// whole 20k-card catalogue.
const API = 'https://api.tcgdex.net/v2/en/cards';

/**
 * The TCGdex id for one of our cards, or null when the enrichment pass found no match.
 * It's recovered from the stored image URL (.../en/<serie>/<set>/<localId>/low.webp) rather
 * than kept in a column of its own, since that URL already encodes it.
 */
export function tcgdexIdFor(cardId) {
  const row = get('SELECT image_webp as webp FROM tcg_cards WHERE id = @id', { id: cardId });
  if (!row?.webp) return null;
  const parts = row.webp.split('/');
  const localId = parts[parts.length - 2];
  const setId = parts[parts.length - 3];
  if (!localId || !setId) return null;
  return `${setId}-${localId}`;
}

/**
 * Live prices for one card, one entry per printing. Retries once: the upstream drops the
 * occasional request, and a single blip shouldn't surface as an error.
 */
export async function fetchCardPricing(tcgdexId, cardId) {
  let upstream;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      upstream = await fetch(`${API}/${tcgdexId}`);
      if (upstream.ok) break;
      throw new Error(String(upstream.status));
    } catch (err) {
      if (attempt === 1) throw err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  const card = await upstream.json();
  const rows = card.variants_detailed ?? [];

  // This endpoint carries prices but no labels; the labels live in the stored printings,
  // which came from GraphQL. There is no shared key between the two, so they're matched by
  // position — the arrays are the same list from the same source.
  //
  // Guarded rather than assumed: if the finishes don't line up in the same order, the
  // labels are dropped and each row falls back to its bare type. A mislabelled price is
  // worse than an unlabelled one, given a 1st Edition print can be worth several times an
  // Unlimited one.
  const printings = cardId ? printingsFor(cardId) : [];
  const aligned =
    printings.length === rows.length && printings.every((p, i) => p.type === rows[i].type);

  return {
    updated: card.updated ?? null,
    aligned,
    // Every printing's marketplace product ids, unfiltered by whether TCGdex priced it —
    // other services are keyed by TCGplayer product id, and a printing TCGdex has no price
    // for may still be covered elsewhere.
    productIds: rows.map((v, position) => ({
      position,
      type: v.type,
      tcgPlayerId: v.thirdParty?.tcgplayer ?? null,
      cardmarketId: v.thirdParty?.cardmarket ?? null,
    })),
    variants: rows
      .map((v, position) => ({
        position,
        type: v.type,
        label: aligned ? printings[position].label : printingLabel({ type: v.type }),
        tcgplayer: v.pricing?.tcgplayer ?? null,
        cardmarket: v.pricing?.cardmarket ?? null,
      }))
      // Unpriced printings are still real printings, but there's nothing to show for them
      // in a price panel.
      .filter((v) => v.tcgplayer || v.cardmarket),
  };
}

/**
 * Flattens one card's pricing into storable rows: one per variant and marketplace, holding
 * whichever headline number that marketplace publishes (TCGplayer quotes a market price per
 * finish; Cardmarket a trend/average for the card).
 */
export function priceRowsFor(cardId, pricing, capturedOn) {
  const rows = [];
  for (const variant of pricing.variants) {
    const tcgUnit = variant.tcgplayer?.unit ?? 'USD';
    const bucket = Object.entries(variant.tcgplayer ?? {}).find(
      ([key, value]) => key !== 'unit' && key !== 'updated' && value && typeof value === 'object',
    )?.[1];
    if (bucket && (bucket.marketPrice != null || bucket.lowPrice != null)) {
      rows.push({
        cardId,
        variant: variant.type,
        variantPosition: variant.position,
        source: 'tcgplayer',
        capturedOn,
        currency: tcgUnit,
        market: bucket.marketPrice ?? null,
        low: bucket.lowPrice ?? null,
      });
    }

    const cm = variant.cardmarket;
    const cmValue = typeof cm?.trend === 'number' ? cm.trend : typeof cm?.avg === 'number' ? cm.avg : null;
    if (cmValue != null) {
      rows.push({
        cardId,
        variant: variant.type,
        variantPosition: variant.position,
        source: 'cardmarket',
        capturedOn,
        currency: String(cm.unit ?? 'EUR'),
        market: cmValue,
        low: typeof cm.low === 'number' ? cm.low : null,
      });
    }
  }
  return rows;
}
