import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Personal data — the collections a user creates, their contents, and app settings —
// lives in its own database file, physically separate from catalog.sqlite (the synced
// Pokémon/card reference data). The sync database is disposable and rebuildable from
// PokeAPI/pokemon-tcg-data at any time; this one is not, and is the piece that would move
// somewhere else (e.g. cloud storage) if this app were ever hosted rather than run
// locally, while the sync data stays local per-install. Because they're separate SQLite
// connections (not ATTACHed into one), there's no cross-database SQL JOIN possible — code
// that needs both (e.g. "which cards are in this box") fetches from each side separately
// and combines the results in JavaScript.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'personal.sqlite');
export const personalDb = new DatabaseSync(dbPath);

personalDb.exec('PRAGMA foreign_keys = ON;');
personalDb.exec('PRAGMA journal_mode = WAL;');

const schema = fs.readFileSync(path.join(__dirname, 'personalSchema.sql'), 'utf-8');
personalDb.exec(schema);

// One-time migration: collection_boxes/collection_entries/settings used to live in
// pokedex.sqlite. If that file still has them (an install from before this split), copy
// the rows over once and drop them there — after this runs once, that table simply won't
// exist in the legacy file anymore, so this is naturally a no-op on every later startup.
//
// The filename below is deliberately the old one, not catalog.sqlite: it names the file an
// older install actually has on disk, so it stays correct rather than tracking the rename.
function migrateFromLegacyDatabase() {
  const legacyPath = path.join(dataDir, 'pokedex.sqlite');
  if (!fs.existsSync(legacyPath)) return;

  const legacy = new DatabaseSync(legacyPath);
  try {
    const hasLegacyTable = legacy
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='collection_boxes'")
      .get();
    if (!hasLegacyTable) return;

    const boxes = legacy.prepare('SELECT * FROM collection_boxes').all();
    const entries = legacy.prepare('SELECT * FROM collection_entries').all();
    const settingsRows = legacy.prepare('SELECT * FROM settings').all();

    personalDb.exec('BEGIN');
    try {
      const insertBox = personalDb.prepare(
        `INSERT OR IGNORE INTO collection_boxes (id, name, type, color, created_at)
         VALUES (@id, @name, @type, @color, @created_at)`,
      );
      for (const box of boxes) insertBox.run(box);

      const insertEntry = personalDb.prepare(
        `INSERT OR IGNORE INTO collection_entries (id, box_id, card_id, quantity, added_at)
         VALUES (@id, @box_id, @card_id, @quantity, @added_at)`,
      );
      for (const entry of entries) insertEntry.run(entry);

      const upsertSetting = personalDb.prepare(
        `INSERT INTO settings (key, value) VALUES (@key, @value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      );
      for (const row of settingsRows) upsertSetting.run(row);

      personalDb.exec('COMMIT');
    } catch (err) {
      personalDb.exec('ROLLBACK');
      throw err;
    }

    legacy.exec('DROP TABLE IF EXISTS collection_entries');
    legacy.exec('DROP TABLE IF EXISTS collection_boxes');
    legacy.exec('DROP TABLE IF EXISTS settings');

    console.log(
      `[personal-db] Migrated ${boxes.length} collection(s), ${entries.length} card ` +
        `entr${entries.length === 1 ? 'y' : 'ies'}, and ${settingsRows.length} setting(s) ` +
        'into server/data/personal.sqlite.',
    );
  } finally {
    legacy.close();
  }
}

migrateFromLegacyDatabase();

// A copy of a card is now its own row rather than a quantity on a shared one: two copies of
// the same card can differ in printing, condition and what they are worth, and a single
// counter cannot hold any of that.
//
// The rebuild is needed for the UNIQUE(box_id, card_id, variant_position) constraint as much
// as the column — that constraint is precisely what forced a second copy to become a count.
// SQLite cannot drop either in place, so the table is recreated and the rows carried over,
// with any quantity above one expanded into that many rows.
function migrateCollectionEntriesToOneRowPerCopy() {
  const columns = personalDb.prepare('PRAGMA table_info(collection_entries)').all();
  if (columns.length === 0) return;
  if (!columns.some((c) => c.name === 'quantity')) return;

  const rows = personalDb
    .prepare('SELECT id, box_id, card_id, quantity, added_at, variant_position FROM collection_entries')
    .all();

  personalDb.exec('PRAGMA foreign_keys = OFF');
  personalDb.exec('BEGIN');
  try {
    personalDb.exec('ALTER TABLE collection_entries RENAME TO collection_entries_old');
    personalDb.exec(`CREATE TABLE collection_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      box_id INTEGER NOT NULL REFERENCES collection_boxes(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL,
      added_at TEXT NOT NULL,
      variant_position INTEGER
    )`);
    const insert = personalDb.prepare(
      `INSERT INTO collection_entries (box_id, card_id, added_at, variant_position)
       VALUES (@boxId, @cardId, @addedAt, @variantPosition)`,
    );
    let written = 0;
    for (const row of rows) {
      for (let copy = 0; copy < Math.max(1, row.quantity ?? 1); copy++) {
        insert.run({
          boxId: row.box_id,
          cardId: row.card_id,
          addedAt: row.added_at,
          variantPosition: row.variant_position,
        });
        written++;
      }
    }
    personalDb.exec('DROP TABLE collection_entries_old');
    personalDb.exec('CREATE INDEX IF NOT EXISTS idx_collection_entries_card ON collection_entries(card_id)');
    personalDb.exec('CREATE INDEX IF NOT EXISTS idx_collection_entries_box ON collection_entries(box_id)');
    personalDb.exec('COMMIT');
    console.log(
      `[personal-db] Collection entries are one row per copy: ${rows.length} rows became ${written}.`,
    );
  } catch (err) {
    personalDb.exec('ROLLBACK');
    throw err;
  } finally {
    personalDb.exec('PRAGMA foreign_keys = ON');
  }
}

migrateCollectionEntriesToOneRowPerCopy();


// Adds the print-variant dimension to collection_entries. The column itself could be added
// in place, but the UNIQUE constraint has to widen from (box_id, card_id) to include the
// variant, and SQLite can't alter a constraint — so the table is rebuilt and copied. Runs
// inside a transaction: this is the one database in the app that can't be regenerated.
function migrateCollectionEntryVariants() {
  const columns = personalDb.prepare('PRAGMA table_info(collection_entries)').all();
  if (columns.length === 0) return;
  // `variant_position` as well as `variant`: a later migration renamed the column, so a
  // database past that point has neither the old name nor any need of this rebuild. Checking
  // only for `variant` meant this ran again on every start, quietly rebuilding the table.
  if (columns.some((c) => c.name === 'variant' || c.name === 'variant_position')) return;

  const before = personalDb.prepare('SELECT COUNT(*) as c FROM collection_entries').get().c;
  personalDb.exec('BEGIN');
  try {
    personalDb.exec(`
      CREATE TABLE collection_entries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        box_id INTEGER NOT NULL REFERENCES collection_boxes(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        added_at TEXT NOT NULL,
        variant TEXT,
        UNIQUE(box_id, card_id, variant)
      );
      INSERT INTO collection_entries_new (id, box_id, card_id, quantity, added_at, variant)
        SELECT id, box_id, card_id, quantity, added_at, NULL FROM collection_entries;
      DROP TABLE collection_entries;
      ALTER TABLE collection_entries_new RENAME TO collection_entries;
      CREATE INDEX IF NOT EXISTS idx_collection_entries_card ON collection_entries(card_id);
      CREATE INDEX IF NOT EXISTS idx_collection_entries_box ON collection_entries(box_id);
    `);
    const after = personalDb.prepare('SELECT COUNT(*) as c FROM collection_entries').get().c;
    if (after !== before) throw new Error(`row count changed during migration: ${before} -> ${after}`);
    personalDb.exec('COMMIT');
    console.log(`[personal-db] Added print-variant support to ${after} collection entr${after === 1 ? 'y' : 'ies'}.`);
  } catch (err) {
    personalDb.exec('ROLLBACK');
    throw err;
  }
}

migrateCollectionEntryVariants();

// A recorded printing used to be a bare finish name ('holo'), which can't tell two
// printings of the same finish apart — the thing that separates a 1st Edition Shadowless
// Charizard from an Unlimited one. It's now the printing's position in that card's variant
// list. Existing values can't be mapped onto a position (a finish name doesn't identify
// which of several rows sharing it was meant), so they're cleared to "printing not
// recorded" rather than guessed at, and the entries themselves are preserved.
function migrateEntryVariantPositions() {
  const columns = personalDb.prepare('PRAGMA table_info(collection_entries)').all();
  if (columns.length === 0) return;
  if (columns.some((c) => c.name === 'variant_position')) return;

  personalDb.exec('BEGIN');
  try {
    personalDb.exec(`
      CREATE TABLE collection_entries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        box_id INTEGER NOT NULL REFERENCES collection_boxes(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        added_at TEXT NOT NULL,
        variant_position INTEGER,
        UNIQUE(box_id, card_id, variant_position)
      );
      INSERT INTO collection_entries_new (id, box_id, card_id, quantity, added_at, variant_position)
        SELECT id, box_id, card_id, quantity, added_at, NULL FROM collection_entries;
      DROP TABLE collection_entries;
      ALTER TABLE collection_entries_new RENAME TO collection_entries;
      CREATE INDEX IF NOT EXISTS idx_collection_entries_card ON collection_entries(card_id);
      CREATE INDEX IF NOT EXISTS idx_collection_entries_box ON collection_entries(box_id);
    `);
    personalDb.exec('COMMIT');
    console.log('[personal-db] Collection entries now record which printing a copy is.');
  } catch (err) {
    personalDb.exec('ROLLBACK');
    throw err;
  }
}

migrateEntryVariantPositions();

// Price history is keyed per printing now. Snapshots are re-captured daily, so the old rows
// are dropped rather than back-filled with a position they never carried. The table is
// recreated here rather than left to the schema file: unlike the sync database, this one
// applies its schema before migrations run, so a plain DROP would leave nothing behind.
function migratePriceHistoryPositions() {
  const columns = personalDb.prepare('PRAGMA table_info(card_price_history)').all();
  if (columns.length === 0) return;
  if (columns.some((c) => c.name === 'service')) return;
  personalDb.exec(`
    DROP TABLE card_price_history;
    CREATE TABLE card_price_history (
      card_id TEXT NOT NULL,
      variant_position INTEGER NOT NULL,
      variant TEXT NOT NULL,
      service TEXT NOT NULL,
      source TEXT NOT NULL,
      condition TEXT,
      captured_on TEXT NOT NULL,
      currency TEXT NOT NULL,
      market REAL,
      low REAL,
      volume INTEGER,
      PRIMARY KEY (card_id, variant_position, service, source, condition, captured_on)
    );
    CREATE INDEX IF NOT EXISTS idx_card_price_history_card ON card_price_history(card_id, captured_on);
  `);
  console.log('[personal-db] Rebuilt price history per service and condition — the next refresh repopulates it.');
}

migratePriceHistoryPositions();

// Per-collection appearance and manual ordering, both added after the table existed. Plain
// ALTER TABLE is enough: they are new nullable columns, and null already means "the default
// icon" and "not placed yet".
function migrateCollectionBoxAppearance() {
  const columns = personalDb.prepare('PRAGMA table_info(collection_boxes)').all();
  if (columns.length === 0) return;
  if (!columns.some((c) => c.name === 'icon')) {
    personalDb.exec('ALTER TABLE collection_boxes ADD COLUMN icon TEXT');
  }
  if (!columns.some((c) => c.name === 'position')) {
    personalDb.exec('ALTER TABLE collection_boxes ADD COLUMN position INTEGER');
    // Seed the order from the order they were created, so the page looks unchanged until
    // something is actually dragged. Without this every existing collection would sort as
    // "unplaced" at once and the first drag would appear to shuffle the rest.
    personalDb.exec('UPDATE collection_boxes SET position = id WHERE position IS NULL');
  }
}

migrateCollectionBoxAppearance();

export function personalAll(sql, params = {}) {
  return personalDb.prepare(sql).all(params);
}

export function personalGet(sql, params = {}) {
  return personalDb.prepare(sql).get(params);
}

export function personalRun(sql, params = {}) {
  return personalDb.prepare(sql).run(params);
}
