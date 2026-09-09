import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

// Named for what it holds — the synced card and species catalogue — rather than for the
// app, which keeps it meaningful next to personal.sqlite and matches the `catalog` schema
// this data moves into if the app is ever hosted.
//
// It was called pokedex.sqlite before the app was renamed. An install still holding that
// file is opened as-is rather than ignored: starting an empty database here would silently
// discard 20,000 synced cards, and the only symptom would be an app that looks empty.
const catalogPath = path.join(dataDir, 'catalog.sqlite');
const preRenamePath = path.join(dataDir, 'pokedex.sqlite');
const dbPath =
  !fs.existsSync(catalogPath) && fs.existsSync(preRenamePath) ? preRenamePath : catalogPath;
export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

// tcg_cards used to have a single pokemon_id FK; it's now a many-to-many via
// tcg_card_pokemon (tag-team/GX cards can belong to more than one Pokemon). Migrate any
// existing rows from the old shape before the new schema is applied.
function migrateLegacyTcgCards() {
  const columns = db.prepare("PRAGMA table_info(tcg_cards)").all();
  if (columns.length === 0) return;
  const hasPokemonId = columns.some((c) => c.name === 'pokemon_id');
  if (!hasPokemonId) return;

  db.exec('ALTER TABLE tcg_cards RENAME TO tcg_cards_legacy');
  db.exec(`
    CREATE TABLE tcg_cards (
      id TEXT PRIMARY KEY,
      name TEXT,
      number TEXT,
      set_id TEXT,
      set_name TEXT,
      series TEXT,
      rarity TEXT,
      release_date TEXT,
      image_small TEXT,
      image_large TEXT
    );
    CREATE TABLE IF NOT EXISTS tcg_card_pokemon (
      card_id TEXT NOT NULL REFERENCES tcg_cards(id) ON DELETE CASCADE,
      pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
      PRIMARY KEY (card_id, pokemon_id)
    );
  `);
  db.exec(`
    INSERT INTO tcg_cards (id, name, set_name, series, rarity, image_small, image_large)
    SELECT id, name, set_name, series, rarity, image_small, image_large FROM tcg_cards_legacy
  `);
  db.exec(`
    INSERT OR IGNORE INTO tcg_card_pokemon (card_id, pokemon_id)
    SELECT id, pokemon_id FROM tcg_cards_legacy WHERE pokemon_id IS NOT NULL
  `);
  db.exec('DROP TABLE tcg_cards_legacy');
}

migrateLegacyTcgCards();

// Adds regional-variant support (Alolan/Galarian/Hisuian/Paldean forms) to an existing
// pokemon table. Plain ALTER TABLE ADD COLUMN is enough here since these are new nullable
// (or defaulted) columns, not a structural change.
function migratePokemonVariantColumns() {
  const columns = db.prepare('PRAGMA table_info(pokemon)').all();
  if (columns.length === 0) return;
  const names = columns.map((c) => c.name);
  if (!names.includes('is_default_variety')) {
    db.exec('ALTER TABLE pokemon ADD COLUMN is_default_variety INTEGER NOT NULL DEFAULT 1');
  }
  if (!names.includes('variant_label')) {
    db.exec('ALTER TABLE pokemon ADD COLUMN variant_label TEXT');
  }
}

migratePokemonVariantColumns();

// Trainer/Energy cards were previously discarded at sync time (they link to no Pokémon), so
// databases synced before that changed have no supertype column to record what a card is.
function migrateTcgCardSupertype() {
  const columns = db.prepare('PRAGMA table_info(tcg_cards)').all();
  if (columns.length === 0) return;
  if (columns.some((c) => c.name === 'supertype')) return;
  db.exec('ALTER TABLE tcg_cards ADD COLUMN supertype TEXT');
}

migrateTcgCardSupertype();

// The lighter TCGdex artwork is filled in by a separate enrichment pass, so existing
// databases need the column before that pass can run.
function migrateTcgCardImageWebp() {
  const columns = db.prepare('PRAGMA table_info(tcg_cards)').all();
  if (columns.length === 0) return;
  if (columns.some((c) => c.name === 'image_webp')) return;
  db.exec('ALTER TABLE tcg_cards ADD COLUMN image_webp TEXT');
}

migrateTcgCardImageWebp();

// The printed artist credit, added after the cards table existed, so existing databases need
// the column before the next card sync can fill it.
function migrateTcgCardIllustrator() {
  const columns = db.prepare('PRAGMA table_info(tcg_cards)').all();
  if (columns.length === 0) return;
  if (columns.some((c) => c.name === 'illustrator')) return;
  db.exec('ALTER TABLE tcg_cards ADD COLUMN illustrator TEXT');
}

migrateTcgCardIllustrator();

// Which TCGdex card each of ours matched to. Previously inferred from the image_webp URL,
// which only works for cards TCGdex holds artwork for; the column records the match itself
// so a card can be priced whether or not it has a picture. Existing rows stay null until the
// next card sync refills them, and the inference remains as a fallback until then.
function migrateTcgCardTcgdexId() {
  const columns = db.prepare('PRAGMA table_info(tcg_cards)').all();
  if (columns.length === 0) return;
  if (columns.some((c) => c.name === 'tcgdex_id')) return;
  db.exec('ALTER TABLE tcg_cards ADD COLUMN tcgdex_id TEXT');
}

migrateTcgCardTcgdexId();

// Scrydex artwork already stored before the sync learned to refuse it.
//
// Their terms forbid mirroring, and the app is about to start caching art onto devices for
// offline use, so those URLs have to go. Nothing is lost: every card carrying one is also
// covered by TCGdex, whose high-resolution file is the same path as the thumbnail with the
// size swapped. The small image is simply cleared — the card query already prefers
// image_webp and falls back to image_small, so it resolves to TCGdex on its own.
function migrateAwayFromScrydex() {
  const columns = db.prepare('PRAGMA table_info(tcg_cards)').all();
  if (columns.length === 0) return;
  if (!columns.some((c) => c.name === 'image_webp')) return;

  const large = db.prepare(
    `UPDATE tcg_cards SET image_large = REPLACE(image_webp, '/low.webp', '/high.webp')
     WHERE image_large LIKE '%scrydex.com%' AND image_webp IS NOT NULL`,
  ).run();
  const small = db.prepare(
    "UPDATE tcg_cards SET image_small = NULL WHERE image_small LIKE '%scrydex.com%'",
  ).run();
  const symbols = db.prepare(
    "UPDATE tcg_sets SET symbol_url = NULL WHERE symbol_url LIKE '%scrydex.com%'",
  ).run();

  const moved = Number(large.changes) + Number(small.changes) + Number(symbols.changes);
  if (moved > 0) {
    console.log(`[db] Re-pointed ${large.changes} card images to TCGdex and cleared ${small.changes} thumbnails and ${symbols.changes} set symbols hosted by Scrydex.`);
  }
}

migrateAwayFromScrydex();

// Distinguishes a scheduled run from one the user started; older rows keep a null trigger.
function migrateSyncLogTrigger() {
  const columns = db.prepare('PRAGMA table_info(sync_log)').all();
  if (columns.length === 0) return;
  if (columns.some((c) => c.name === 'trigger')) return;
  db.exec('ALTER TABLE sync_log ADD COLUMN trigger TEXT');
}

migrateSyncLogTrigger();

// The variant table used to hold one row per boolean flag (card_id, variant) and couldn't
// tell two printings of the same finish apart. It now holds one row per actual printing.
// Dropped rather than migrated because every row is re-derived from upstream by the
// enrichment pass — this database is rebuildable by design.
function migrateCardVariantsToPrintings() {
  const columns = db.prepare('PRAGMA table_info(tcg_card_variants)').all();
  if (columns.length === 0) return;
  if (columns.some((c) => c.name === 'position')) return;
  db.exec('DROP TABLE tcg_card_variants');
  console.log('[db] Rebuilt tcg_card_variants for per-printing detail — re-run the TCG sync to refill it.');
}

migrateCardVariantsToPrintings();

// collection_boxes/collection_entries/settings used to live in this database; they now
// live in their own file (see personalDb.js) so personal data — collections and their
// contents, and app settings — can eventually be hosted completely separately from the
// synced Pokémon/card reference data. personalDb.js's own startup migrates any existing
// rows out of this database (if present) and drops these tables here, so nothing in this
// file's schema references them anymore.

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// A sync_log row can be orphaned in 'running' state if the process was killed or crashed
// mid-sync (in-memory sync state always starts fresh on boot, so any row still claiming
// 'running' at startup is stale, not actually in progress).
db.prepare(
  `UPDATE sync_log SET status = 'error', completed_at = @now,
     error = 'Interrupted by server restart'
   WHERE status = 'running'`,
).run({ now: new Date().toISOString() });

export function upsert(table, row, conflictColumns) {
  const columns = Object.keys(row);
  const placeholders = columns.map((c) => `@${c}`).join(', ');
  const updates = columns
    .filter((c) => !conflictColumns.includes(c))
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');

  const sql = `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT(${conflictColumns.join(', ')}) DO UPDATE SET ${updates}
  `;

  const stmt = db.prepare(sql);
  const params = {};
  for (const c of columns) {
    params[c] = row[c] === undefined ? null : row[c];
  }
  stmt.run(params);
}

export function all(sql, params = {}) {
  return db.prepare(sql).all(params);
}

export function get(sql, params = {}) {
  return db.prepare(sql).get(params);
}

export function run(sql, params = {}) {
  return db.prepare(sql).run(params);
}
