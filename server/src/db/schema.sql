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
  artwork_url TEXT
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
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  name TEXT,
  set_name TEXT,
  series TEXT,
  rarity TEXT,
  image_small TEXT,
  image_large TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  records_synced INTEGER DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_pokemon_name ON pokemon(name);
CREATE INDEX IF NOT EXISTS idx_pokemon_dex ON pokemon(national_dex_number);
CREATE INDEX IF NOT EXISTS idx_tcg_pokemon ON tcg_cards(pokemon_id);
CREATE INDEX IF NOT EXISTS idx_evolutions_from ON evolutions(pokemon_id);
CREATE INDEX IF NOT EXISTS idx_evolutions_to ON evolutions(evolves_into_id);
