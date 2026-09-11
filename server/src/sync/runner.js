import { run } from '../db/index.js';
import { syncPokeApi } from './pokeapi.js';
import { syncTcgCards } from './tcgapi.js';
import { syncTcgdexEnrichment } from './tcgdex.js';
import { syncOwnedCardPrices } from './prices.js';
import { syncLogos } from './logos.js';

let activeSync = null;

export function getActiveSync() {
  return activeSync;
}

// `trigger` records whether a run was started by a button ('manual') or by the daily
// schedule ('auto'), so both show up as their own entries in the sync log.
function startLog(source, trigger = 'manual') {
  const startedAt = new Date().toISOString();
  const result = run(
    `INSERT INTO sync_log (source, started_at, status, trigger)
     VALUES (@source, @startedAt, @status, @trigger)`,
    { source, startedAt, status: 'running', trigger },
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
  const logId = startLog('tcg');
  activeSync = { source: 'tcg', logId };
  try {
    const result = await syncTcgCards({
      onProgress: (p) => progressLog(logId, p.synced),
    });
    // Enrichment runs off the cards just stored, so it has to follow the catalogue sync.
    // A failure here is not fatal: it only costs the lighter images and variant data, and
    // the catalogue itself is already committed.
    let enrichment = null;
    try {
      enrichment = await syncTcgdexEnrichment({
        onProgress: () => progressLog(logId, result.synced),
      });
    } catch (err) {
      console.error(`TCGdex enrichment failed (cards are still synced): ${err.message}`);
    }
    finishLog(logId, result.synced);
    return { ...result, enrichment };
  } catch (err) {
    failLog(logId, err);
    throw err;
  } finally {
    activeSync = null;
  }
}

// Prices go through the runner like the other syncs so a manual refresh shows up in the
// same history table, and so a price refresh can't run on top of a catalogue sync. The
// scheduled daily check calls this too — it's only the "is it due?" decision that lives in
// prices.js.
export async function runPriceSync({ trigger = 'manual' } = {}) {
  if (activeSync) throw new Error('A sync is already running');
  const logId = startLog('prices', trigger);
  activeSync = { source: 'prices', logId };
  try {
    const result = await syncOwnedCardPrices({
      onProgress: (p) => progressLog(logId, p.done),
    });
    console.log(
      `[prices] ${result.capturedOn}: ${result.cards} owned — ${result.attempted} fetched, ` +
        `${result.skipped} already held, ${result.deferred} deferred (provider limit), ` +
        `${result.rowsWritten} rows written`,
    );
    finishLog(logId, result.rowsWritten);
    return result;
  } catch (err) {
    failLog(logId, err);
    throw err;
  } finally {
    activeSync = null;
  }
}

// Logos go through the runner so the settings page can show them beside the other sources and
// so they cannot run on top of a catalogue sync — the targets are read from tcg_sets, which a
// catalogue sync is in the middle of rewriting.
export async function runLogoSync() {
  if (activeSync) throw new Error('A sync is already running');
  const logId = startLog('logos');
  activeSync = { source: 'logos', logId };
  try {
    const result = await syncLogos({ onProgress: (p) => progressLog(logId, p.done) });
    console.log(
      `[logos] ${result.written} downloaded, ${result.skipped} already held, ${result.failed} failed — ` +
        `${(result.bytes / 1048576).toFixed(1)} MB`,
    );
    finishLog(logId, result.written + result.skipped);
    return result;
  } catch (err) {
    failLog(logId, err);
    throw err;
  } finally {
    activeSync = null;
  }
}
