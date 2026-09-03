import { Router } from 'express';
import { all } from '../db/index.js';
import { getTcgApiKey } from './settings.js';
import { getActiveSync, runPokeApiSync, runTcgSync } from '../sync/runner.js';

export const syncRouter = Router();

syncRouter.get('/status', (_req, res) => {
  const rows = all(
    `SELECT source, started_at as startedAt, completed_at as completedAt,
            status, records_synced as recordsSynced, error
     FROM sync_log ORDER BY id DESC LIMIT 10`,
  );
  res.json({ active: getActiveSync(), history: rows });
});

syncRouter.post('/pokeapi', (req, res) => {
  if (getActiveSync()) {
    res.status(409).json({ error: 'A sync is already running' });
    return;
  }
  const start = req.body?.start ? Number(req.body.start) : undefined;
  const end = req.body?.end ? Number(req.body.end) : undefined;
  runPokeApiSync({ start, end }).catch((err) => console.error('PokeAPI sync failed:', err));
  res.json({ started: true });
});

syncRouter.post('/tcg', (_req, res) => {
  if (getActiveSync()) {
    res.status(409).json({ error: 'A sync is already running' });
    return;
  }
  if (!getTcgApiKey()) {
    res.status(400).json({ error: 'No TCG API key saved. Add one in Settings.' });
    return;
  }
  runTcgSync().then(
    () => {},
    (err) => {
      console.error('TCG sync failed:', err);
    },
  );
  res.json({ started: true });
});
