import { Router } from 'express';
import { all } from '../db/index.js';
import { getActiveSync, runPokeApiSync, runPriceSync, runTcgSync } from '../sync/runner.js';

export const syncRouter = Router();

syncRouter.get('/status', (_req, res) => {
  const rows = all(
    `SELECT source, started_at as startedAt, completed_at as completedAt,
            status, records_synced as recordsSynced, error, trigger
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
  runTcgSync().then(
    () => {},
    (err) => {
      console.error('TCG sync failed:', err);
    },
  );
  res.json({ started: true });
});

// Refreshes prices for owned cards now, ignoring the daily schedule — pressing the button
// means "I want today's numbers", and a same-day run overwrites that day's rows rather
// than adding duplicates, so there's no harm in running it more than once.
syncRouter.post('/prices', (_req, res) => {
  if (getActiveSync()) {
    res.status(409).json({ error: 'A sync is already running' });
    return;
  }
  runPriceSync().then(
    () => {},
    (err) => {
      console.error('Price sync failed:', err);
    },
  );
  res.json({ started: true });
});
