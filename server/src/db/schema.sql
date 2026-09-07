CREATE TABLE IF NOT EXISTS pokemon (
  id INTEGER PRIMARY KEY,
  national_dex_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  generation TEXT,
  height INTEGER,
  weight INTEGER,
  base_experience INTEGER,
  flavor_text TEXT,
  sprite_url TEXT,
  artwork_url TEXT,
  is_default_variety INTEGER NOT NULL DEFAULT 1,
  variant_label TEXT
);

CREATE TABLE IF NOT EXISTS types (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS pokemon_types (
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  type_id INTEGER NOT NULL REFERENCES types(id),
  slot INTEGER NOT NULL,
  PRIMARY KEY (pokemon_id, type_id)
);

CREATE TABLE IF NOT EXISTS abilities (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  effect TEXT
);

CREATE TABLE IF NOT EXISTS pokemon_abilities (
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  ability_id INTEGER NOT NULL REFERENCES abilities(id),
  is_hidden INTEGER NOT NULL DEFAULT 0,
  slot INTEGER NOT NULL,
  PRIMARY KEY (pokemon_id, ability_id)
);

CREATE TABLE IF NOT EXISTS stats (
  pokemon_id INTEGER PRIMARY KEY REFERENCES pokemon(id) ON DELETE CASCADE,
  hp INTEGER,
  attack INTEGER,
  defense INTEGER,
  special_attack INTEGER,
  special_defense INTEGER,
  speed INTEGER
);

CREATE TABLE IF NOT EXISTS evolutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  evolves_into_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  trigger TEXT,
  min_level INTEGER,
  item TEXT,
  UNIQUE(pokemon_id, evolves_into_id)
);

CREATE TABLE IF NOT EXISTS tcg_cards (
  id TEXT PRIMARY KEY,
  name TEXT,
  number TEXT,
  set_id TEXT,
  set_name TEXT,
  series TEXT,
  rarity TEXT,
  release_date TEXT,
  image_small TEXT,
  image_large TEXT,
  -- "Pokémon", "Trainer" or "Energy". The latter two link to no Pokémon at all, so this is
  -- the only thing identifying what such a card is.
  supertype TEXT,
  -- A far lighter copy of the same artwork (~19KB webp against ~180KB png), sourced from
  -- TCGdex by the enrichment pass. Null where no confident match was found, in which case
  -- the original image_small is served instead.
  image_webp TEXT,
  -- The card's artist, as printed. Called `artist` upstream and `illustrator` by TCGdex; the
  -- printed credit is the same person either way.
  illustrator TEXT
);

-- One row per distinct printing of a card. `type` is the finish (normal, reverse, holo);
-- `subtype` and `stamp` are what separate the printings that share a finish — Base Set
-- Charizard has four holo rows that are really Unlimited, Shadowless, Shadowless 1st
-- Edition, and the 1999-2000 copyright print, and they differ in value by around 7x.
--
-- `position` is the card's index in the upstream variant array. It's the primary key
-- alongside card_id because type+subtype can repeat, and it's the only thing that lines
-- these rows up with the pricing endpoint's array, which carries prices but no labels.
CREATE TABLE IF NOT EXISTS tcg_card_variants (
  card_id TEXT NOT NULL REFERENCES tcg_cards(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT,
  stamp TEXT,
  size TEXT,
  foil TEXT,
  PRIMARY KEY (card_id, position)
);

-- Many-to-many: most cards belong to exactly one Pokemon, but tag-team/GX/VSTAR cards can
-- list multiple nationalPokedexNumbers, so a single card row can link to several here.
CREATE TABLE IF NOT EXISTS tcg_card_pokemon (
  card_id TEXT NOT NULL REFERENCES tcg_cards(id) ON DELETE CASCADE,
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, pokemon_id)
);

-- The energy type printed on the card, which is NOT the same vocabulary as a Pokémon's
-- types: the TCG uses Colorless, Lightning, Darkness and Metal where the games use Normal,
-- Electric, Dark and Steel, and it collapses dual types down to the one energy the card is
-- played as (Base Set Charizard is Fire, not Fire/Flying). Kept in its own table rather
-- than reusing `types`, which holds the Pokémon vocabulary.
CREATE TABLE IF NOT EXISTS tcg_card_types (
  card_id TEXT NOT NULL REFERENCES tcg_cards(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  slot INTEGER NOT NULL,
  PRIMARY KEY (card_id, type)
);
CREATE INDEX IF NOT EXISTS idx_tcg_card_types_type ON tcg_card_types(type);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  records_synced INTEGER DEFAULT 0,
  error TEXT,
  -- 'manual' when someone pressed a button, 'auto' when the daily price schedule started
  -- it, so an unattended refresh is visible in the log as its own entry rather than being
  -- indistinguishable from one the user asked for.
  trigger TEXT
);

CREATE INDEX IF NOT EXISTS idx_pokemon_name ON pokemon(name);
CREATE INDEX IF NOT EXISTS idx_pokemon_dex ON pokemon(national_dex_number);
CREATE INDEX IF NOT EXISTS idx_tcg_card_pokemon_pokemon ON tcg_card_pokemon(pokemon_id);
CREATE INDEX IF NOT EXISTS idx_evolutions_from ON evolutions(pokemon_id);
CREATE INDEX IF NOT EXISTS idx_evolutions_to ON evolutions(evolves_into_id);

-- Matches the card browser's default sort chain expression for expression, so SQLite can
-- walk cards in display order straight out of the index instead of sorting all ~17k rows
-- into a temp B-tree on every page request. Without it, paging deeper costs progressively
-- more (the full set is sorted, then everything before the offset is discarded): page 1
-- measured ~19ms and page 280 ~57ms, versus ~0.2ms and ~10ms with the index in place.
-- Only the default chain is covered; the other sort options still fall back to a sort.
CREATE INDEX IF NOT EXISTS idx_tcg_cards_default_sort
  ON tcg_cards((release_date IS NULL), release_date, set_name, CAST(number as INTEGER), id);

-- Sets get their own table rather than more columns on tcg_cards: 174 rows against 20,000+,
-- and the symbol is the same string for every card in a set.
CREATE TABLE IF NOT EXISTS tcg_sets (
  id TEXT PRIMARY KEY,
  name TEXT,
  series TEXT,
  release_date TEXT,
  -- The small set symbol printed on the card, and the full wordmark. Both ship in the same
  -- dataset the cards come from.
  symbol_url TEXT,
  logo_url TEXT
);

-- Series wordmarks, keyed by the series name the cards already carry. TCGdex publishes one
-- per series (in practice the first set's logo), which pokemontcg.io does not.
CREATE TABLE IF NOT EXISTS tcg_series (
  name TEXT PRIMARY KEY,
  logo_url TEXT
);
