-- Personal data: the collections a user creates and their contents, plus app settings.
-- Deliberately its own database file, physically separate from catalog.sqlite (the synced
-- Pokémon/card reference data) — see personalDb.js for why. Because of that separation,
-- card_id below is NOT a foreign key into tcg_cards (a different database can't enforce a
-- cross-database constraint); an entry whose card no longer exists in the sync database
-- (e.g. after a resync drops it) is simply skipped when rendering, not auto-deleted.

-- type is one of 'box' | 'deck' | 'collection' — enforced in the route layer, not here.
-- color is one of the palette keys in client/src/lib/collectionColors.ts, or NULL for
-- the default (uncolored) look.
CREATE TABLE IF NOT EXISTS collection_boxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'box',
  color TEXT,
  created_at TEXT NOT NULL
);

-- One row per (box, card, variant) — adding the same card and variant to the same box
-- again just bumps quantity, rather than creating duplicate rows. The same card can have
-- separate entries across different boxes, and separate entries per print variant within
-- one box, so three normal copies and one reverse holo are counted apart.
--
-- variant_position identifies WHICH printing a copy is, indexing into that card's rows in
-- tcg_card_variants — so a 1st Edition Shadowless Charizard is tracked apart from an
-- Unlimited one, which matters because they differ in value by roughly 7x. NULL means the
-- printing wasn't recorded, which is what the one-tap add flow stores: naming a printing is
-- a deliberate act, not something to slow down filing a card.
--
-- Note that SQLite treats NULLs as distinct for UNIQUE purposes, so this constraint does
-- NOT stop two (box, card, NULL) rows on its own; the route layer is what keeps them
-- collapsed, matching with `variant_position IS @variantPosition` and bumping quantity.
CREATE TABLE IF NOT EXISTS collection_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  box_id INTEGER NOT NULL REFERENCES collection_boxes(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  -- One row per physical copy: two copies of a card can be different printings worth very
  -- different amounts, so there is deliberately no quantity and no uniqueness across
  -- (box, card, printing) that would collapse them back into a count.
  variant_position INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Daily price snapshots for cards the user owns. This lives in the personal database, not
-- the sync one, because it is the one kind of price data that cannot be re-fetched: the
-- upstream only ever serves today's number, so a day not captured is gone for good. That
-- makes it irreplaceable in exactly the way collections are, and it must survive a wipe and
-- resync of catalog.sqlite.
--
-- One row per card, variant, marketplace and day, so re-running on the same day overwrites
-- rather than accumulating duplicates. `variant` is the marketplace's own finish name
-- (holo, reverse, normal), matching what the pricing source reports.
CREATE TABLE IF NOT EXISTS card_price_history (
  card_id TEXT NOT NULL,
  variant_position INTEGER NOT NULL,
  variant TEXT NOT NULL,
  -- Which API this came from (tcgdex, pokemonpricetracker, ...) and which marketplace it
  -- quotes (tcgplayer, cardmarket). Charts are drawn per service+marketplace so a single
  -- chart never mixes currencies.
  service TEXT NOT NULL,
  source TEXT NOT NULL,
  -- Card condition where the service distinguishes them (Near Mint, Damaged, ...); NULL for
  -- services that quote a single price per printing.
  condition TEXT,
  captured_on TEXT NOT NULL,
  currency TEXT NOT NULL,
  market REAL,
  low REAL,
  volume INTEGER,
  PRIMARY KEY (card_id, variant_position, service, source, condition, captured_on)
);

CREATE INDEX IF NOT EXISTS idx_card_price_history_card ON card_price_history(card_id, captured_on);

-- API keys for the user's own accounts on external services. `secret` is ciphertext (see
-- lib/secrets.js); `key_hint` is a masked fragment purely so the UI can show which key is
-- stored without ever handing the key back out.
-- Daily exchange rates, so a price captured weeks ago converts at that day's rate rather
-- than today's. Always stored with USD as the base; any pair is derived from two of these.
CREATE TABLE IF NOT EXISTS fx_rates (
  date TEXT NOT NULL,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate REAL NOT NULL,
  PRIMARY KEY (date, base, quote)
);

CREATE TABLE IF NOT EXISTS linked_accounts (
  service TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  last_verified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_collection_entries_card ON collection_entries(card_id);
CREATE INDEX IF NOT EXISTS idx_collection_entries_box ON collection_entries(box_id);
