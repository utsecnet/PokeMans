import { secretFor } from './linkedAccounts.js';

// PokemonPriceTracker quotes TCGplayer prices per printing AND per card condition, and
// returns a dated series rather than only today's figure — the one source we've found that
// does. It's reached with the user's own API key, entered under Settings → Link Accounts.
//
// Cards are matched by TCGplayer product id, which TCGdex already stores against each
// printing, so this needs no name/number matching of its own.
const BASE = 'https://www.pokemonpricetracker.com/api/v2';
const SERVICE = 'pokemonpricetracker';

export function isLinked() {
  return !!secretFor(SERVICE);
}

/**
 * One card's history from PokemonPriceTracker, keyed by TCGplayer product id.
 * Returns null when no key is linked, so callers can simply skip this source.
 */
export async function fetchHistory(tcgPlayerId) {
  const key = secretFor(SERVICE);
  if (!key) return null;

  const res = await fetch(`${BASE}/cards?tcgPlayerId=${encodeURIComponent(tcgPlayerId)}&includeHistory=true`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 401 || res.status === 403) throw new Error('API key rejected');
  if (res.status === 429) throw new Error('Daily credit allowance reached');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body = await res.json();
  const card = body?.data ?? body;
  if (!card?.priceHistory) return { card: null, points: [], creditsRemaining: remaining(res) };

  // priceHistory.variants[printing][condition].history = [{date, market, volume}]
  const points = [];
  for (const [printing, conditions] of Object.entries(card.priceHistory.variants ?? {})) {
    for (const [condition, entry] of Object.entries(conditions ?? {})) {
      for (const point of entry?.history ?? []) {
        if (typeof point?.market !== 'number') continue;
        points.push({
          printing,
          condition,
          capturedOn: String(point.date).slice(0, 10),
          market: point.market,
          volume: typeof point.volume === 'number' ? point.volume : null,
        });
      }
    }
  }
  return { card, points, creditsRemaining: remaining(res) };
}

function remaining(res) {
  const value = res.headers.get('x-ratelimit-daily-remaining');
  return value == null ? null : Number(value);
}

export const PPT_SERVICE_ID = SERVICE;
