import { Router } from 'express';
import {
  listLinkedAccounts,
  providerById,
  removeLinkedAccount,
  saveLinkedAccount,
} from '../lib/linkedAccounts.js';
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
settingsRouter.get('/linked-accounts', (_req, res) => {
  res.json({ providers: listLinkedAccounts() });
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
