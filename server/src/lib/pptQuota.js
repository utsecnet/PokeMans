import { personalGet, personalRun } from '../db/personalDb.js';

/**
 * PokemonPriceTracker's remaining allowance, read off the headers it already returns.
 *
 * Recorded rather than polled. The free tier is 100 calls a day, so a Settings page that
 * asked "how many do I have left?" on every visit would spend the thing it is reporting —
 * ten glances would be a tenth of the day's budget. Every response the app already makes
 * carries the full picture, so the numbers are captured in passing and shown with the time
 * they were true.
 *
 * A rejected request is the one free reading: a 429 carries the same headers and costs
 * nothing, which is exactly when the user most wants to look.
 */
const KEY = 'pokemonpricetracker.quota';

const num = (headers, name) => {
  const raw = headers.get(name);
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/** Pulls the quota out of any PokemonPriceTracker response. Null when it carried none. */
export function quotaFromHeaders(headers) {
  const dailyLimit = num(headers, 'x-ratelimit-daily-limit');
  const dailyRemaining = num(headers, 'x-ratelimit-daily-remaining');
  if (dailyLimit == null && dailyRemaining == null) return null;

  const resetUnix = num(headers, 'x-ratelimit-daily-reset');
  return {
    dailyLimit,
    dailyRemaining,
    // Credits bought on top of the tier's daily allowance. They don't reset, so they are
    // reported apart from the daily figure rather than folded into one total.
    purchasedRemaining: num(headers, 'x-ratelimit-purchased-remaining'),
    totalRemaining: num(headers, 'x-ratelimit-total-remaining'),
    minuteLimit: num(headers, 'x-ratelimit-minute-limit'),
    minuteRemaining: num(headers, 'x-ratelimit-minute-remaining'),
    resetsAt: resetUnix == null ? null : new Date(resetUnix * 1000).toISOString(),
    observedAt: new Date().toISOString(),
  };
}

/** Stores a reading. Called for every response, successful or refused. */
export function recordQuota(headers) {
  const quota = quotaFromHeaders(headers);
  if (!quota) return null;
  personalRun(
    `INSERT INTO settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    { key: KEY, value: JSON.stringify(quota) },
  );
  return quota;
}

/**
 * The last reading, with whether it still describes today.
 *
 * `stale` means the allowance has reset since it was taken, so the remaining figure is
 * certainly wrong and certainly too low — the UI says so rather than showing a confident
 * number that is out of date.
 */
export function readQuota() {
  const row = personalGet('SELECT value FROM settings WHERE key = @key', { key: KEY });
  if (!row) return null;
  let quota;
  try {
    quota = JSON.parse(row.value);
  } catch {
    return null;
  }
  const stale = quota.resetsAt ? Date.parse(quota.resetsAt) <= Date.now() : false;
  return { ...quota, stale };
}
