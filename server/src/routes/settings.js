import { Router } from 'express';
import { get, run } from '../db/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';

export const settingsRouter = Router();

function getSetting(key) {
  const row = get('SELECT value FROM settings WHERE key = @key', { key });
  return row ? row.value : null;
}

function setSetting(key, value) {
  run(
    `INSERT INTO settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    { key, value },
  );
}

function deleteSetting(key) {
  run('DELETE FROM settings WHERE key = @key', { key });
}

export function getTcgApiKey() {
  const encrypted = getSetting('tcg_api_key');
  if (encrypted) {
    try {
      return decrypt(encrypted);
    } catch {
      return null;
    }
  }
  return process.env.TCG_API_KEY || null;
}

settingsRouter.get('/', (_req, res) => {
  res.json({ tcgApiKeySet: !!getTcgApiKey() });
});

settingsRouter.put('/tcg-api-key', (req, res) => {
  const apiKey = req.body?.apiKey;
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    res.status(400).json({ error: 'apiKey is required' });
    return;
  }
  setSetting('tcg_api_key', encrypt(apiKey.trim()));
  res.json({ ok: true });
});

settingsRouter.delete('/tcg-api-key', (_req, res) => {
  deleteSetting('tcg_api_key');
  res.json({ ok: true });
});
