import { Router } from 'express';
import { all, get } from '../db/index.js';
import { personalGet } from '../db/personalDb.js';
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

// What each source has actually produced, so the settings page can show the state of the data
// rather than three buttons whose effect is invisible until something looks wrong.
syncRouter.get('/sources', (_req, res) => {
  const lastRun = (source) =>
    all(
      `SELECT started_at as startedAt, status, records_synced as recordsSynced, trigger
       FROM sync_log WHERE source = @source ORDER BY id DESC LIMIT 1`,
      { source },
    )[0] ?? null;

  res.json({
    sources: [
      {
        id: 'pokeapi',
        counts: [
          { label: 'species', value: get('SELECT COUNT(*) n FROM pokemon').n },
          { label: 'evolutions', value: get('SELECT COUNT(*) n FROM evolutions').n },
        ],
        lastRun: lastRun('pokeapi'),
      },
      {
        id: 'tcg',
        counts: [
          { label: 'cards', value: get('SELECT COUNT(*) n FROM tcg_cards').n },
          { label: 'printings', value: get('SELECT COUNT(*) n FROM tcg_card_variants').n },
        ],
        lastRun: lastRun('tcg'),
      },
      {
        id: 'prices',
        counts: [
          {
            label: 'cards priced',
            value: personalGet('SELECT COUNT(DISTINCT card_id) n FROM card_price_history').n,
          },
          {
            label: 'records',
            value: personalGet('SELECT COUNT(*) n FROM card_price_history').n,
          },
        ],
        lastRun: lastRun('prices'),
      },
    ],
  });
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
