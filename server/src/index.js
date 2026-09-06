import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardsRouter } from './routes/cards.js';
import { collectionRouter } from './routes/collection.js';
import { pokemonRouter } from './routes/pokemon.js';
import { syncRouter } from './routes/sync.js';
import { settingsRouter } from './routes/settings.js';
import { isPriceSyncDue } from './sync/prices.js';
import { runPriceSync } from './sync/runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/pokemon', pokemonRouter);
app.use('/api/cards', cardsRouter);
app.use('/api/sync', syncRouter);
app.use('/api/collection', collectionRouter);
app.use('/api/settings', settingsRouter);

const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Every route handler here is currently synchronous, which Express already converts a
// thrown error from into a 500 on its own — this exists so that (a) API error responses
// are always clean JSON instead of Express's default HTML stack-trace page, and (b) any
// async handler added later that forgets its own try/catch still gets a safe response
// instead of an unhandled rejection, which crashes the process on modern Node.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Daily price snapshots for owned cards. Checked shortly after startup and then every few
// hours, rather than at a fixed clock time: on a machine that sleeps overnight a scheduled
// 3am run would simply never happen, whereas an "is it due?" check catches up whenever the
// server next runs. The upstream refreshes all its prices in one batch anyway, so there is
// nothing to gain from a tighter schedule.
const PRICE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PRICE_CHECK_STARTUP_DELAY_MS = 20_000;

async function checkPricesDue() {
  if (!isPriceSyncDue()) return;
  try {
    // Through the runner, so a scheduled refresh lands in the same history as a manual one
    // and can't start on top of a catalogue sync already in progress.
    const result = await runPriceSync({ trigger: 'auto' });
    console.log(
      `[prices] Captured ${result.rowsWritten} price row(s) for ${result.priced}/${result.cards} owned card(s)` +
        `${result.unmatched ? `, ${result.unmatched} with no pricing source` : ''}` +
        `${result.failed ? `, ${result.failed} failed` : ''}.`,
    );
  } catch (err) {
    // Never let a price refresh take the server down; it retries on the next interval.
    console.error(`[prices] Sync failed: ${err.message}`);
  }
}

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`PokéMans server listening on http://localhost:${port}`);
  // Delayed so a restart doesn't compete with the first page load for bandwidth.
  setTimeout(checkPricesDue, PRICE_CHECK_STARTUP_DELAY_MS).unref();
  setInterval(checkPricesDue, PRICE_CHECK_INTERVAL_MS).unref();
});
