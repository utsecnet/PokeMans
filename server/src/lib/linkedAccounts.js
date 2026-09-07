import { personalAll, personalGet, personalRun } from '../db/personalDb.js';
import { decryptSecret, encryptSecret, maskSecret } from './secrets.js';

// Every external service the user can link their own account to. This is a plain list so
// that adding another provider is a data change here plus a `verify` function — the storage,
// the routes and the Settings UI all iterate over it and need no changes.
//
// `verify` proves a key works before it's saved, so a typo is caught at entry rather than
// silently producing empty data on the next sync.
export const PROVIDERS = [
  {
    id: 'pokemonpricetracker',
    name: 'PokemonPriceTracker',
    site: 'https://www.pokemonpricetracker.com',
    signupUrl: 'https://www.pokemonpricetracker.com/api',
    /** Optional one-liner under the field; omitted when the service needs no explaining. */
    summary: null,
    keyLabel: 'API key',
    keyPlaceholder: 'pokeprice_…',
    async verify(key) {
      const res = await fetch('https://www.pokemonpricetracker.com/api/v2/sets?limit=1', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'That key was rejected by PokemonPriceTracker.' };
      }
      if (!res.ok) return { ok: false, message: `PokemonPriceTracker returned ${res.status}.` };
      const remaining = res.headers.get('x-ratelimit-daily-remaining');
      return {
        ok: true,
        message: remaining ? `Key accepted — ${remaining} credits remaining today.` : 'Key accepted.',
      };
    },
  },
];

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/**
 * Every provider with its link status. Deliberately returns a masked hint and never the key
 * itself — nothing in the API surface hands a stored key back out.
 */
export function listLinkedAccounts() {
  const rows = new Map(
    personalAll('SELECT service, key_hint as hint, linked_at as linkedAt, last_verified_at as lastVerifiedAt FROM linked_accounts').map(
      (r) => [r.service, r],
    ),
  );
  return PROVIDERS.map((p) => {
    const row = rows.get(p.id);
    return {
      id: p.id,
      name: p.name,
      site: p.site,
      signupUrl: p.signupUrl,
      summary: p.summary,
      keyLabel: p.keyLabel,
      keyPlaceholder: p.keyPlaceholder,
      linked: !!row,
      keyHint: row?.hint ?? null,
      linkedAt: row?.linkedAt ?? null,
      lastVerifiedAt: row?.lastVerifiedAt ?? null,
    };
  });
}

/** The decrypted key for a service, or null when not linked (or the key can't be read). */
export function secretFor(serviceId) {
  const row = personalGet('SELECT secret FROM linked_accounts WHERE service = @service', {
    service: serviceId,
  });
  if (!row) return null;
  return decryptSecret(row.secret);
}

export function saveLinkedAccount(serviceId, key, verifiedAt = null) {
  const now = new Date().toISOString();
  personalRun(
    `INSERT INTO linked_accounts (service, secret, key_hint, linked_at, last_verified_at)
     VALUES (@service, @secret, @hint, @now, @verifiedAt)
     ON CONFLICT(service) DO UPDATE SET
       secret = excluded.secret, key_hint = excluded.key_hint,
       last_verified_at = excluded.last_verified_at`,
    {
      service: serviceId,
      secret: encryptSecret(key),
      hint: maskSecret(key),
      now,
      verifiedAt,
    },
  );
}

export function removeLinkedAccount(serviceId) {
  personalRun('DELETE FROM linked_accounts WHERE service = @service', { service: serviceId });
}
