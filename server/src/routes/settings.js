import { Router } from 'express';
import {
  listLinkedAccounts,
  providerById,
  removeLinkedAccount,
  saveLinkedAccount,
  secretFor,
} from '../lib/linkedAccounts.js';
import { readQuota, recordQuota } from '../lib/pptQuota.js';
import { storageBreakdown } from '../lib/storage.js';
import { SUPPORTED_CURRENCIES, displayCurrency, setDisplayCurrency } from '../lib/fx.js';

export const settingsRouter = Router();

// One display currency for the whole app, so charts don't split into a chart per
// marketplace currency. Values are converted at the rate for each point's own date.
settingsRouter.get('/currency', (_req, res) => {
  res.json({ currency: displayCurrency(), supported: SUPPORTED_CURRENCIES });
});

settingsRouter.put('/currency', (req, res) => {
  const currency = String(req.body?.currency ?? '').toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    res.status(400).json({ error: `Unsupported currency. Choose one of: ${SUPPORTED_CURRENCIES.join(', ')}` });
    return;
  }
  setDisplayCurrency(currency);
  res.json({ currency, supported: SUPPORTED_CURRENCIES });
});

// Accounts on external services that the user links with their own API key. Keys are stored
// encrypted and are never returned by any endpoint here — the UI only ever sees a masked
// hint, so a stored key can't be read back out through the API.
/**
 * What the databases hold, by kind of data. Computed on request rather than cached: dbstat
 * walks every page, which on an 11MB file is a few milliseconds, and a stale figure on a
 * page whose entire purpose is "how big is this now" would be worse than the cost.
 */
settingsRouter.get('/storage', (_req, res) => {
  res.json(storageBreakdown());
});

settingsRouter.get('/linked-accounts', (_req, res) => {
  res.json({ providers: listLinkedAccounts() });
});

/**
 * Re-reads the allowance from the provider. Separate from GET because it costs one call:
 * the page shows what was last observed for free, and spending a credit to refresh it is
 * the user's decision, not a side effect of opening Settings.
 */
settingsRouter.post('/linked-accounts/:service/quota', async (req, res) => {
  const provider = providerById(String(req.params.service));
  if (!provider) return res.status(404).json({ error: 'Unknown service' });
  const key = secretFor(provider.id);
  if (!key) return res.status(400).json({ error: 'No key linked for that service' });

  try {
    // Deliberately the cheapest endpoint the provider has, and its headers are what we are
    // after — the body is discarded.
    const upstream = await fetch('https://www.pokemonpricetracker.com/api/v2/sets?limit=1', {
      headers: { Authorization: `Bearer ${key}` },
    });
    recordQuota(upstream.headers);
    res.json({ quota: readQuota() });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Could not reach the service' });
  }
});

settingsRouter.put('/linked-accounts/:service', async (req, res) => {
  const provider = providerById(String(req.params.service));
  if (!provider) {
    res.status(404).json({ error: 'Unknown service' });
    return;
  }
  const key = String(req.body?.key ?? '').trim();
  if (!key) {
    res.status(400).json({ error: 'A key is required' });
    return;
  }

  // Checked against the service before storing, so a typo surfaces here rather than as
  // silently missing data on the next sync.
  let verification = { ok: true, message: null };
  try {
    if (provider.verify) verification = await provider.verify(key);
  } catch (err) {
    verification = { ok: false, message: `Could not reach ${provider.name}: ${err.message}` };
  }
  if (!verification.ok) {
    res.status(400).json({ error: verification.message ?? 'That key was rejected.' });
    return;
  }

  saveLinkedAccount(provider.id, key, new Date().toISOString());
  res.json({ ok: true, message: verification.message, providers: listLinkedAccounts() });
});

settingsRouter.delete('/linked-accounts/:service', (req, res) => {
  const provider = providerById(String(req.params.service));
  if (!provider) {
    res.status(404).json({ error: 'Unknown service' });
    return;
  }
  removeLinkedAccount(provider.id);
  res.json({ ok: true, providers: listLinkedAccounts() });
});
