import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pokemonRouter } from './routes/pokemon.js';
import { settingsRouter } from './routes/settings.js';
import { syncRouter } from './routes/sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/pokemon', pokemonRouter);
app.use('/api/sync', syncRouter);
app.use('/api/settings', settingsRouter);

const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`PokeDex server listening on http://localhost:${port}`);
});
