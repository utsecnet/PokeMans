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
 *
 * The enrichment pass records it directly. Older rows predate that column and fall back to
 * recovering it from the stored image URL (.../en/<serie>/<set>/<localId>/low.webp), which
 * encodes the same thing — but only for cards TCGdex holds artwork for. Relying on that
 * alone meant 816 matched cards, whole subsets among them (Shining Fates Shiny Vault, the
 * Trainer Galleries, Dragon Majesty), were never priced despite having prices upstream,
 * because a card with no picture looked identical to a card with no match.
 */
export function tcgdexIdFor(cardId) {
  const row = get('SELECT tcgdex_id as tcgdexId, image_webp as webp FROM tcg_cards WHERE id = @id', {
    id: cardId,
  });
  if (row?.tcgdexId) return row.tcgdexId;
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

// TCGdex attaches prices to each entry in variants_detailed on some cards and only to the
// card as a whole on others — about a third of the catalogue is the latter. Reading only the
// per-variant copy silently produced no prices at all for those, which looked like "this card
// has no price" rather than "we didn't look in the second place".
//
// The card-level object still distinguishes finishes, just by naming rather than nesting:
// Cardmarket suffixes the holo figures ("avg" vs "avg-holo") and TCGplayer nests one object
// per finish ("normal", "reverse-holofoil"). Both are unpicked here per variant.
const TCGPLAYER_KEYS = {
  normal: ['normal'],
  holo: ['holofoil', 'holo'],
  reverse: ['reverse-holofoil', 'reverseHolofoil', 'reverse'],
};

function cardLevelPricing(cardPricing, type, soleVariant) {
  if (!cardPricing) return { tcgplayer: null, cardmarket: null };

  const tp = cardPricing.tcgplayer ?? null;
  let tcgplayer = null;
  if (tp) {
    const finishes = Object.keys(tp).filter((k) => tp[k] && typeof tp[k] === 'object');
    // A card printed one way, priced one way, is that one printing — TCGdex labels some of
    // them "normal" while pricing only the holofoil (Lucario-GX and other holo-only cards),
    // and refusing the match there loses the only price the card has. Anything with more
    // than one printing still has to match by name, so a 1st Edition can't inherit an
    // Unlimited price.
    const key =
      (TCGPLAYER_KEYS[type] ?? []).find((k) => finishes.includes(k)) ??
      (soleVariant && finishes.length === 1 ? finishes[0] : null);
    if (key) tcgplayer = { unit: tp.unit, updated: tp.updated, [key]: tp[key] };
  }

  const cm = cardPricing.cardmarket ?? null;
  let cardmarket = null;
  if (cm) {
    // A holo printing reads the "-holo" figures; every other finish reads the base ones,
    // since Cardmarket publishes no reverse-specific series here.
    let suffix = type === 'holo' ? '-holo' : '';
    const has = (sfx) =>
      typeof cm[`trend${sfx}`] === 'number' || typeof cm[`avg${sfx}`] === 'number';
    // Same one-printing rule: fall to the holo series when the base one is absent.
    if (!has(suffix) && soleVariant && has('-holo')) suffix = '-holo';
    const pick = (field) => cm[`${field}${suffix}`];
    if (typeof pick('trend') === 'number' || typeof pick('avg') === 'number') {
      cardmarket = {
        unit: cm.unit,
        updated: cm.updated,
        avg: pick('avg'),
        low: pick('low'),
        trend: pick('trend'),
      };
    }
  }

  return { tcgplayer, cardmarket };
}

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
      .map((v, position) => {
        const fallback = v.pricing ? null : cardLevelPricing(card.pricing, v.type, rows.length === 1);
        return {
          position,
          type: v.type,
          label: aligned ? printings[position].label : printingLabel({ type: v.type }),
          tcgplayer: v.pricing?.tcgplayer ?? fallback?.tcgplayer ?? null,
          cardmarket: v.pricing?.cardmarket ?? fallback?.cardmarket ?? null,
        };
      })
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
