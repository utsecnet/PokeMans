import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/index.js';
import { personalDb } from '../db/personalDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', '..', 'data');

/**
 * What the databases actually hold, by kind of data.
 *
 * Sizes come from SQLite's `dbstat` virtual table, which reports the real page count for
 * every table and index rather than an estimate from row counts and column widths. That
 * matters because the interesting number here is growth: price history gains a row per card
 * per day forever, and a guess based on average row length would not show the indexes, which
 * for that table are a large share of it.
 *
 * Grouping is by what the data *is*, not by table. A user asking "how much of this is prices"
 * should not have to know that a card's printings live apart from the card.
 */
const GROUPS = {
  catalog: [
    {
      id: 'cards',
      label: 'Cards',
      description: 'Card records, printings, energy types and their links to Pokémon',
      tables: ['tcg_cards', 'tcg_card_variants', 'tcg_card_types', 'tcg_card_pokemon'],
      /** The table whose row count is the meaningful one to show. */
      countOf: 'tcg_cards',
      countLabel: 'cards',
    },
    {
      id: 'sets',
      label: 'Expansions',
      description: 'Sets and series, with their symbols and logos',
      tables: ['tcg_sets', 'tcg_series'],
      countOf: 'tcg_sets',
      countLabel: 'sets',
    },
    {
      id: 'pokedex',
      label: 'Pokédex',
      description: 'Species, stats, abilities, types and evolutions',
      tables: ['pokemon', 'pokemon_types', 'pokemon_abilities', 'abilities', 'stats', 'evolutions', 'types'],
      countOf: 'pokemon',
      countLabel: 'species',
    },
    {
      id: 'syncLog',
      label: 'Sync history',
      description: 'A record of every sync that has run',
      tables: ['sync_log'],
      countOf: 'sync_log',
      countLabel: 'runs',
    },
  ],
  personal: [
    {
      id: 'prices',
      label: 'Card prices',
      description: 'Daily price snapshots — the one thing here that cannot be re-downloaded',
      tables: ['card_price_history'],
      countOf: 'card_price_history',
      countLabel: 'price points',
    },
    {
      id: 'rates',
      label: 'Exchange rates',
      description: 'Daily rates, so an old price converts at the rate of its own day',
      tables: ['fx_rates'],
      countOf: 'fx_rates',
      countLabel: 'rates',
    },
    {
      id: 'collections',
      label: 'Collections',
      description: 'Your collections and every copy filed in them',
      tables: ['collection_boxes', 'collection_entries'],
      countOf: 'collection_entries',
      countLabel: 'cards owned',
    },
    {
      id: 'wants',
      label: 'Want lists',
      description: 'Your want lists and the cards on them',
      tables: ['want_lists', 'want_list_entries'],
      countOf: 'want_list_entries',
      countLabel: 'cards wanted',
    },
    {
      id: 'app',
      label: 'Settings',
      description: 'App settings and linked account keys',
      tables: ['settings', 'linked_accounts'],
      countOf: 'settings',
      countLabel: 'entries',
    },
  ],
};

/** Bytes per table, with each index counted against the table it belongs to. */
function bytesByTable(handle) {
  const owner = new Map(
    handle
      .prepare("SELECT name, tbl_name FROM sqlite_master WHERE name IS NOT NULL")
      .all()
      .map((r) => [r.name, r.tbl_name]),
  );
  const totals = new Map();
  for (const row of handle.prepare('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name').all()) {
    // An index's pages are the table's cost as far as the user is concerned; sqlite_master's
    // internal objects fall back to their own name.
    const table = owner.get(row.name) ?? row.name;
    totals.set(table, (totals.get(table) ?? 0) + Number(row.bytes ?? 0));
  }
  return totals;
}

function rowCount(handle, table) {
  try {
    return Number(handle.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get()?.n ?? 0);
  } catch {
    // A table this build doesn't have yet — report nothing rather than fail the whole page.
    return 0;
  }
}

const sizeOf = (file) => {
  try {
    return fs.statSync(path.join(dataDir, file)).size;
  } catch {
    return 0;
  }
};

/**
 * The database file and its write-ahead log, reported apart.
 *
 * Folding them together was actively misleading: personal.sqlite is a 270KB database with a
 * 4MB WAL behind it, which came out as "4MB free" — implying pages waiting to be reused when
 * really it is a journal that a checkpoint will collapse. They answer different questions, so
 * they get different numbers.
 */
function fileBytes(name) {
  return { main: sizeOf(name), wal: sizeOf(`${name}-wal`) + sizeOf(`${name}-shm`) };
}

export function storageBreakdown() {
  const build = (handle, fileName, groups, id, label) => {
    const byTable = bytesByTable(handle);
    const claimed = new Set(groups.flatMap((g) => g.tables));
    const items = groups.map((group) => ({
      id: group.id,
      label: group.label,
      description: group.description,
      bytes: group.tables.reduce((sum, t) => sum + (byTable.get(t) ?? 0), 0),
      count: rowCount(handle, group.countOf),
      countLabel: group.countLabel,
    }));

    let other = 0;
    for (const [table, bytes] of byTable) if (!claimed.has(table)) other += bytes;
    if (other > 0) {
      items.push({
        id: 'other',
        label: 'Other',
        description: "SQLite's own bookkeeping, and anything added since this list was written",
        bytes: other,
        count: 0,
        countLabel: '',
      });
    }

    const { main, wal } = fileBytes(fileName);
    const used = items.reduce((s, i) => s + i.bytes, 0);
    return {
      id,
      label,
      file: fileName,
      onDisk: main + wal,
      main,
      wal,
      used,
      // Pages freed by deletes that SQLite keeps for reuse rather than returning to the OS.
      // Named rather than hidden: it is why the file can exceed the sum of its contents.
      free: Math.max(0, main - used),
      items: items.sort((a, b) => b.bytes - a.bytes),
    };
  };

  return {
    databases: [
      build(db, 'catalog.sqlite', GROUPS.catalog, 'catalog', 'Synced reference data'),
      build(personalDb, 'personal.sqlite', GROUPS.personal, 'personal', 'Your data'),
    ],
  };
}
