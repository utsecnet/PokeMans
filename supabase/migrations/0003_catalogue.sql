-- =====================================================================================
-- PokéMans — the shared catalogue
--
-- Every Pokémon and every card that exists. One copy, serving all users. Nobody's
-- personal data is in here; these are facts about cards, and two people looking at
-- Charizard see exactly the same row.
--
-- Faithfully ported from server/data/catalog.sqlite, with three deliberate changes:
-- SQLite's 0/1 integer flags become real booleans, its TEXT dates become real dates so
-- sorting works, and the search index at the bottom exists because the browser now asks
-- the server to search rather than searching a local copy.
--
-- Run in the Supabase SQL editor, or via `supabase db push`. Idempotent.
-- =====================================================================================

-- Substring search on card names. `where name ilike '%char%'` cannot use a normal index;
-- a trigram index can, and it is the difference between a sequential scan of 20,635 rows
-- on every keystroke and an index lookup.
create extension if not exists pg_trgm;

-- -------------------------------------------------------------------------------------
-- Pokémon species
--
-- `id` is PokéAPI's own id, not one we generate — it is the join key back to the upstream
-- and must survive a re-sync unchanged, so it is never an identity column.
-- -------------------------------------------------------------------------------------
create table if not exists public.types (
  id    integer primary key,
  name  text not null unique
);

create table if not exists public.abilities (
  id      integer primary key,
  name    text not null unique,
  effect  text
);

create table if not exists public.pokemon (
  id                   integer primary key,
  national_dex_number  integer not null,
  name                 text not null,
  generation           text,
  height               integer,
  weight               integer,
  base_experience      integer,
  flavor_text          text,
  -- The upstream image addresses. Kept as the source record even though the app serves
  -- its own localised copies; a re-sync needs to know where a file came from.
  sprite_url           text,
  artwork_url          text,
  -- Alternate forms (Alolan, Mega, Gigantamax) share a dex number with the base species.
  is_default_variety   boolean not null default true,
  variant_label        text
);

create index if not exists pokemon_dex_idx on public.pokemon (national_dex_number);
create index if not exists pokemon_name_trgm_idx on public.pokemon using gin (name gin_trgm_ops);

create table if not exists public.pokemon_types (
  pokemon_id  integer not null references public.pokemon (id) on delete cascade,
  type_id     integer not null references public.types (id),
  slot        integer not null,
  primary key (pokemon_id, type_id)
);

create table if not exists public.pokemon_abilities (
  pokemon_id  integer not null references public.pokemon (id) on delete cascade,
  ability_id  integer not null references public.abilities (id),
  is_hidden   boolean not null default false,
  slot        integer not null,
  primary key (pokemon_id, ability_id)
);

create table if not exists public.stats (
  pokemon_id       integer primary key references public.pokemon (id) on delete cascade,
  hp               integer,
  attack           integer,
  defense          integer,
  special_attack   integer,
  special_defense  integer,
  speed            integer
);

create table if not exists public.evolutions (
  id               bigint generated always as identity primary key,
  pokemon_id       integer not null references public.pokemon (id) on delete cascade,
  evolves_into_id  integer not null references public.pokemon (id) on delete cascade,
  trigger          text,
  min_level        integer,
  item             text,

  constraint evolutions_pair_once unique (pokemon_id, evolves_into_id)
);

create index if not exists evolutions_from_idx on public.evolutions (pokemon_id);

-- -------------------------------------------------------------------------------------
-- Trading cards
--
-- `tcg_cards.id` is the upstream card id ("base1-4"), which is also what collection
-- entries and price rows point at. It is a text natural key for the same reason as above.
-- -------------------------------------------------------------------------------------
create table if not exists public.tcg_series (
  name      text primary key,
  logo_url  text
);

create table if not exists public.tcg_sets (
  id            text primary key,
  name          text,
  series        text,
  release_date  date,
  -- The small symbol printed on the card, and the full wordmark. Both arrive in the same
  -- dataset the cards do.
  symbol_url    text,
  logo_url      text
);

create index if not exists tcg_sets_series_idx on public.tcg_sets (series);

create table if not exists public.tcg_cards (
  id            text primary key,
  name          text,
  number        text,
  set_id        text,
  set_name      text,
  series        text,
  rarity        text,
  supertype     text,
  illustrator   text,
  release_date  date,
  image_small   text,
  image_large   text,
  image_webp    text,
  tcgdex_id     text
);

-- The card browser's real access paths: by set, by rarity, newest first, and by name.
create index if not exists tcg_cards_set_idx on public.tcg_cards (set_id);
create index if not exists tcg_cards_rarity_idx on public.tcg_cards (rarity);
create index if not exists tcg_cards_release_idx on public.tcg_cards (release_date desc nulls last);
create index if not exists tcg_cards_name_trgm_idx on public.tcg_cards using gin (name gin_trgm_ops);

-- The printings of a card. A 1st Edition Shadowless Charizard and an Unlimited one are
-- the same card and roughly 7x apart in value, which is why prices hang off this and not
-- off tcg_cards.
create table if not exists public.tcg_card_variants (
  card_id   text not null references public.tcg_cards (id) on delete cascade,
  position  integer not null,
  type      text not null,
  subtype   text,
  stamp     text,
  size      text,
  foil      text,
  primary key (card_id, position)
);

create table if not exists public.tcg_card_pokemon (
  card_id     text not null references public.tcg_cards (id) on delete cascade,
  pokemon_id  integer not null references public.pokemon (id) on delete cascade,
  primary key (card_id, pokemon_id)
);

-- "every card featuring this Pokémon" — the species page asks this.
create index if not exists tcg_card_pokemon_species_idx
  on public.tcg_card_pokemon (pokemon_id);

create table if not exists public.tcg_card_types (
  card_id  text not null references public.tcg_cards (id) on delete cascade,
  type     text not null,
  slot     integer not null,
  primary key (card_id, type)
);

-- -------------------------------------------------------------------------------------
-- sync_log — what the sync did, and whether it worked.
--
-- Admin-only reading. Users have no use for it and it is the one shared table that says
-- something about how the service is run rather than about cards.
-- -------------------------------------------------------------------------------------
create table if not exists public.sync_log (
  id              bigint generated always as identity primary key,
  source          text not null,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  status          text not null,
  records_synced  integer default 0,
  trigger         text,
  error           text
);

create index if not exists sync_log_started_idx on public.sync_log (started_at desc);

-- =====================================================================================
-- Access
--
-- The rule for every table above: anyone signed in may read it, and nobody may write it.
--
-- "Signed in" includes the anonymous accounts a visitor silently receives on arrival, so
-- browsing works with no sign-up form. What it excludes is the `anon` role — the
-- signed-out state, whose key ships inside the web page. That key can therefore do
-- nothing at all, which is the whole point: there is no endpoint a stranger can script
-- against without first obtaining an account, and account creation is rate-limited and
-- CAPTCHA-gated.
--
-- No write policy exists, for any of these tables, for anyone. Writes come only from the
-- sync function, which holds the service role and bypasses RLS entirely. So even your own
-- admin account, in a browser, cannot alter the catalogue — there is no path for it to
-- take. A compromised admin session can trigger a sync; it cannot corrupt 20,000 rows.
-- =====================================================================================

do $access$
declare
  t text;
begin
  for t in
    select unnest(array[
      'types', 'abilities', 'pokemon', 'pokemon_types', 'pokemon_abilities',
      'stats', 'evolutions',
      'tcg_series', 'tcg_sets', 'tcg_cards', 'tcg_card_variants',
      'tcg_card_pokemon', 'tcg_card_types'
    ])
  loop
    execute format('alter table public.%I enable row level security', t);

    -- Remove the grant Supabase hands to anon by default. RLS already stops it; this
    -- means a policy added here by mistake still could not expose the table publicly.
    execute format('revoke all on table public.%I from anon', t);

    execute format('drop policy if exists %I on public.%I', t || '_read_signed_in', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read_signed_in', t);
  end loop;
end
$access$;

-- sync_log is the exception: admin reads it, nobody else sees it exists.
alter table public.sync_log enable row level security;
revoke all on table public.sync_log from anon;

drop policy if exists sync_log_read_admin on public.sync_log;
create policy sync_log_read_admin on public.sync_log
  for select to authenticated
  using (public.is_admin());
