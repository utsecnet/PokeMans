import { personalAll, personalGet, personalRun } from '../db/personalDb.js';

// Prices arrive in whichever currency the marketplace quotes — TCGplayer in USD, Cardmarket
// in EUR — so showing them on one chart means converting to a currency the user picks.
//
// Rates are stored per day and applied per point, not "today's rate applied to everything":
// a price from a month ago converted at today's rate would be quietly wrong, and that error
// grows as the history does. Rates come from Frankfurter (European Central Bank reference
// rates, free, no key), always with USD as the base so any pair can be derived.
const API = 'https://api.frankfurter.app';
const BASE = 'USD';

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];
const DISPLAY_CURRENCY_KEY = 'display.currency';

export function displayCurrency() {
  const row = personalGet('SELECT value FROM settings WHERE key = @key', { key: DISPLAY_CURRENCY_KEY });
  const value = row?.value;
  return SUPPORTED_CURRENCIES.includes(value) ? value : 'USD';
}

export function setDisplayCurrency(currency) {
  if (!SUPPORTED_CURRENCIES.includes(currency)) throw new Error(`Unsupported currency: ${currency}`);
  personalRun(
    `INSERT INTO settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    { key: DISPLAY_CURRENCY_KEY, value: currency },
  );
}

/**
 * Makes sure rates exist for the given dates, fetching only what's missing. Failure is not
 * fatal: without a rate a value is shown in its original currency rather than blocking the
 * chart entirely.
 */
export async function ensureRates(dates) {
  const wanted = [...new Set(dates.filter(Boolean))].sort();
  if (wanted.length === 0) return;
  const have = new Set(
    personalAll('SELECT DISTINCT date FROM fx_rates WHERE base = @base', { base: BASE }).map((r) => r.date),
  );
  const missing = wanted.filter((d) => !have.has(d));
  if (missing.length === 0) return;

  const quotes = SUPPORTED_CURRENCIES.filter((c) => c !== BASE).join(',');
  const url =
    missing.length === 1
      ? `${API}/${missing[0]}?from=${BASE}&to=${quotes}`
      : `${API}/${missing[0]}..${missing[missing.length - 1]}?from=${BASE}&to=${quotes}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Frankfurter returned ${res.status}`);
  const body = await res.json();

  // A single date returns {rates:{EUR:..}}; a range returns {rates:{'2026-09-01':{EUR:..}}}.
  const byDate = missing.length === 1 ? { [body.date ?? missing[0]]: body.rates } : body.rates;
  const insert = (date, quote, rate) =>
    personalRun(
      `INSERT INTO fx_rates (date, base, quote, rate) VALUES (@date, @base, @quote, @rate)
       ON CONFLICT(date, base, quote) DO UPDATE SET rate = excluded.rate`,
      { date, base: BASE, quote, rate },
    );

  for (const [date, rates] of Object.entries(byDate ?? {})) {
    for (const [quote, rate] of Object.entries(rates ?? {})) {
      if (typeof rate === 'number') insert(date, quote, rate);
    }
    insert(date, BASE, 1);
  }
}

/** All stored rates, as {date: {currency: rate-from-USD}}. */
export function rateTable() {
  const table = new Map();
  for (const row of personalAll('SELECT date, quote, rate FROM fx_rates WHERE base = @base ORDER BY date', { base: BASE })) {
    if (!table.has(row.date)) table.set(row.date, { [BASE]: 1 });
    table.get(row.date)[row.quote] = row.rate;
  }
  return table;
}

/**
 * Converts one value, using the rate for `date` — or the closest earlier date when a
 * weekend or holiday has no published rate. Returns null when no usable rate exists, so
 * callers can fall back rather than invent a number.
 */
export function convert(value, from, to, date, table) {
  if (value == null) return null;
  if (from === to) return value;

  let rates = table.get(date);
  if (!rates) {
    // ECB doesn't publish at weekends; the most recent prior rate is the right stand-in.
    const earlier = [...table.keys()].filter((d) => d <= date).sort();
    if (earlier.length === 0) return null;
    rates = table.get(earlier[earlier.length - 1]);
  }
  const fromRate = from === BASE ? 1 : rates[from];
  const toRate = to === BASE ? 1 : rates[to];
  if (!fromRate || !toRate) return null;
  // via USD: value / (USD->from) * (USD->to)
  return (value / fromRate) * toRate;
}
