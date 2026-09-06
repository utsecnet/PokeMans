import { personalAll, personalGet, personalRun } from '../db/personalDb.js';
import { fetchCardPricing, priceRowsFor, printingsFor, tcgdexIdFor } from '../lib/cardPricing.js';
import { fetchHistory, isLinked } from '../lib/pokemonPriceTracker.js';
import { sleep } from './http.js';

// Prices are only fetchable one card at a time, so this deliberately walks the cards the
// user owns rather than the catalogue: the cost scales with the size of a collection (tens
// or hundreds of cards) instead of 20,000+, which would take over half an hour of
// continuous requests against an API that advertises no rate limit.
const LAST_RUN_KEY = 'prices.lastRunAt';
const REQUEST_DELAY_MS = 120;
const CONCURRENCY = 3;

function insertPriceRow(row) {
  personalRun(
    `INSERT INTO card_price_history
       (card_id, variant_position, variant, service, source, condition, captured_on,
        currency, market, low, volume)
     VALUES (@cardId, @variantPosition, @variant, @service, @source, @condition, @capturedOn,
             @currency, @market, @low, @volume)
     ON CONFLICT(card_id, variant_position, service, source, condition, captured_on) DO UPDATE SET
       variant = excluded.variant, currency = excluded.currency,
       market = excluded.market, low = excluded.low, volume = excluded.volume`,
    { condition: null, volume: null, ...row },
  );
}

/**
 * Captures one card's prices from every available source. Shared by the daily job and by
 * the moment a card is added to a collection — a card filed today shouldn't have to wait
 * for tomorrow's run before it has any price data.
 */
export async function capturePricesForCard(cardId, capturedOn = new Date().toISOString().slice(0, 10)) {
  const tcgdexId = tcgdexIdFor(cardId);
  if (!tcgdexId) return { rows: 0, unmatched: true, pptRows: 0, creditsRemaining: null };

  const pricing = await fetchCardPricing(tcgdexId, cardId);
  const rows = priceRowsFor(cardId, pricing, capturedOn).map((r) => ({ ...r, service: 'tcgdex' }));
  for (const row of rows) insertPriceRow(row);

  let pptRows = 0;
  let creditsRemaining = null;
  let pptError = null;
  // A linked PokemonPriceTracker account adds a second, richer series: per condition, and
  // dated rather than only today. Contained so a credit limit or rejected key can't undo
  // the TCGdex capture that just succeeded.
  if (isLinked()) {
    const labels = new Map(printingsFor(cardId).map((p) => [p.position, p.type]));
    for (const printing of pricing.productIds ?? []) {
      if (!printing.tcgPlayerId) continue;
      try {
        const result = await fetchHistory(printing.tcgPlayerId);
        if (result?.creditsRemaining != null) creditsRemaining = result.creditsRemaining;
        for (const point of result?.points ?? []) {
          insertPriceRow({
            cardId,
            variantPosition: printing.position,
            variant: labels.get(printing.position) ?? printing.type,
            service: 'pokemonpricetracker',
            source: 'tcgplayer',
            condition: point.condition,
            capturedOn: point.capturedOn,
            currency: 'USD',
            market: point.market,
            low: null,
            volume: point.volume,
          });
          pptRows++;
        }
      } catch (err) {
        pptError = err.message;
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }
  return { rows: rows.length, unmatched: false, pptRows, creditsRemaining, pptError };
}

export function lastPriceSyncAt() {
  const row = personalGet('SELECT value FROM settings WHERE key = @key', { key: LAST_RUN_KEY });
  return row?.value ?? null;
}

function recordRun(at) {
  personalRun(
    `INSERT INTO settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    { key: LAST_RUN_KEY, value: at },
  );
}

/** Distinct cards across every collection — the same card in two boxes is fetched once. */
function ownedCardIds() {
  return personalAll('SELECT DISTINCT card_id as cardId FROM collection_entries').map((r) => r.cardId);
}

export async function syncOwnedCardPrices({ onProgress } = {}) {
  const startedAt = new Date().toISOString();
  const capturedOn = startedAt.slice(0, 10);
  const cardIds = ownedCardIds();

  let priced = 0;
  let unmatched = 0;
  let failed = 0;
  let rowsWritten = 0;
  let done = 0;
  const pptLinked = isLinked();
  let pptRows = 0;
  let pptFailed = 0;
  let pptError = null;
  let pptCreditsRemaining = null;

  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < cardIds.length) {
        const cardId = cardIds[next++];
        try {
          const result = await capturePricesForCard(cardId, capturedOn);
          if (result.unmatched) {
            unmatched++;
          } else {
            rowsWritten += result.rows + result.pptRows;
            pptRows += result.pptRows;
            if (result.rows > 0 || result.pptRows > 0) priced++;
            if (result.creditsRemaining != null) pptCreditsRemaining = result.creditsRemaining;
            if (result.pptError) {
              pptFailed++;
              if (!pptError) pptError = result.pptError;
            }
            await sleep(REQUEST_DELAY_MS);
          }
        } catch (err) {
          failed++;
          console.error(`Price sync: ${cardId} failed — ${err.message}`);
        }
        done++;
        onProgress?.({ done, total: cardIds.length });
      }
    }),
  );

  // Recorded even when individual cards failed: the run happened, and retrying the whole
  // set an hour later would not fix a card the upstream has no price for.
  recordRun(startedAt);

  return {
    cards: cardIds.length,
    priced,
    unmatched,
    failed,
    rowsWritten: rowsWritten + pptRows,
    capturedOn,
    pokemonPriceTracker: pptLinked
      ? { rows: pptRows, failed: pptFailed, error: pptError, creditsRemaining: pptCreditsRemaining }
      : null,
  };
}

/**
 * Whether a scheduled refresh is due. Kept as a plain check rather than a "check and run"
 * helper so the caller can route the run through the sync runner (which owns the log and
 * the one-sync-at-a-time guard) without this module having to depend on it.
 *
 * Due-ness is measured against the last run rather than a fixed clock time because this
 * app runs on a machine that is regularly asleep at whatever hour a cron would have
 * picked — this way a missed day is caught the next time the server is up.
 */
export function isPriceSyncDue({ maxAgeHours = 24 } = {}) {
  const last = lastPriceSyncAt();
  if (!last) return true;
  const ageHours = (Date.now() - new Date(last).getTime()) / 3_600_000;
  return !Number.isFinite(ageHours) || ageHours >= maxAgeHours;
}
