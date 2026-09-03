import { run } from '../db/index.js';
import { getTcgApiKey } from '../routes/settings.js';
import { syncPokeApi } from './pokeapi.js';
import { syncTcgCards } from './tcgapi.js';

let activeSync = null;

export function getActiveSync() {
  return activeSync;
}

function startLog(source) {
  const startedAt = new Date().toISOString();
  const result = run(
    'INSERT INTO sync_log (source, started_at, status) VALUES (@source, @startedAt, @status)',
    { source, startedAt, status: 'running' },
  );
  return Number(result.lastInsertRowid);
}

function progressLog(logId, records) {
  run('UPDATE sync_log SET records_synced = @records WHERE id = @id', { records, id: logId });
}

function finishLog(logId, records) {
  run(
    `UPDATE sync_log SET completed_at = @completedAt, status = 'success', records_synced = @records
     WHERE id = @id`,
    { completedAt: new Date().toISOString(), records, id: logId },
  );
}

function failLog(logId, err) {
  run(
    `UPDATE sync_log SET completed_at = @completedAt, status = 'error', error = @error WHERE id = @id`,
    { completedAt: new Date().toISOString(), error: String(err?.message ?? err), id: logId },
  );
}

export async function runPokeApiSync({ start, end } = {}) {
  if (activeSync) throw new Error('A sync is already running');
  const logId = startLog('pokeapi');
  activeSync = { source: 'pokeapi', logId };
  try {
    const result = await syncPokeApi({
      start,
      end,
      onProgress: (p) => {
        if (p.phase === 'species') progressLog(logId, p.synced);
      },
    });
    finishLog(logId, result.synced);
    return result;
  } catch (err) {
    failLog(logId, err);
    throw err;
  } finally {
    activeSync = null;
  }
}

export async function runTcgSync() {
  if (activeSync) throw new Error('A sync is already running');
  const apiKey = getTcgApiKey();
  if (!apiKey) {
    throw new Error('No TCG API key saved. Add one in Settings.');
  }
  const logId = startLog('tcgapi');
  activeSync = { source: 'tcgapi', logId };
  try {
    const result = await syncTcgCards({
      apiKey,
      onProgress: (p) => progressLog(logId, p.synced),
    });
    finishLog(logId, result.synced);
    return result;
  } catch (err) {
    failLog(logId, err);
    throw err;
  } finally {
    activeSync = null;
  }
}
