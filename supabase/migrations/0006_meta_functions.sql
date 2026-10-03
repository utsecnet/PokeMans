-- =====================================================================================
-- PokéMans — the catalogue's "what values exist" queries
--
-- Every filter dropdown in the app is populated by one of these. They are DISTINCT and
-- GROUP BY queries, which PostgREST cannot express, so they live here as functions rather
-- than being rebuilt as table queries in the client — the same SQL the Express server
-- runs today, ported rather than reinvented.
--
-- All read-only, all over shared reference data, all granted to any signed-in user.
-- `stable` lets Postgres cache them within a statement; none of them write.
--
-- Run in the Supabase SQL editor, or via `supabase db push`. Idempotent.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- Pokémon types and abilities: plain sorted vocabularies.
-- -------------------------------------------------------------------------------------
create or replace function public.meta_pokemon_types()
returns setof text language sql stable set search_path = '' as $$
  select name from public.types order by name;
$$;

create or replace function public.meta_abilities()
returns setof text language sql stable set search_path = '' as $$
  select name from public.abilities order by name;
$$;

-- -------------------------------------------------------------------------------------
-- Generations, in the order they were released.
--
-- Sorted alphabetically, "generation-ix" lands before "generation-v" (i < v) and reads as
-- a stray duplicate next to "generation-iv". Ordering by the lowest dex number in each
-- generation puts them in the order a player would expect. Alternate forms are excluded:
-- a Galarian form belongs to the generation that introduced the form, which would drag
-- older species into newer generations.
-- -------------------------------------------------------------------------------------
create or replace function public.meta_generations()
returns setof text language sql stable set search_path = '' as $$
  select generation
  from public.pokemon
  where generation is not null and is_default_variety
  group by generation
  order by min(national_dex_number);
$$;

-- -------------------------------------------------------------------------------------
-- Card vocabularies. Empty strings are excluded as well as nulls — an unattributed card
-- carries '' rather than null, and a blank entry in a filter list is not a choice.
-- -------------------------------------------------------------------------------------
create or replace function public.meta_card_types()
returns setof text language sql stable set search_path = '' as $$
  select distinct type from public.tcg_card_types order by type;
$$;

create or replace function public.meta_rarities()
returns setof text language sql stable set search_path = '' as $$
  select distinct rarity from public.tcg_cards
  where rarity is not null and rarity <> '' order by rarity;
$$;

create or replace function public.meta_supertypes()
returns setof text language sql stable set search_path = '' as $$
  select distinct supertype from public.tcg_cards
  where supertype is not null and supertype <> '' order by supertype;
$$;

create or replace function public.meta_illustrators()
returns setof text language sql stable set search_path = '' as $$
  select distinct illustrator from public.tcg_cards
  where illustrator is not null and illustrator <> '' order by illustrator;
$$;

-- Series, oldest first — the order they appear on a shelf, not alphabetical.
create or replace function public.meta_series()
returns setof text language sql stable set search_path = '' as $$
  select series from public.tcg_cards
  where series is not null
  group by series
  order by min(release_date);
$$;

-- -------------------------------------------------------------------------------------
-- Expansions: every set that actually has cards, oldest first.
--
-- Grouped from tcg_cards rather than selected from tcg_sets, deliberately. A set with no
-- cards in the catalogue is not a filter anyone can usefully pick, and the release date
-- used for ordering is the earliest card's, which is what the app sorts and groups by.
-- -------------------------------------------------------------------------------------
create or replace function public.meta_expansions()
returns table (
  id text,
  name text,
  series text,
  "releaseDate" date,
  "symbolUrl" text
)
language sql stable set search_path = '' as $$
  select c.set_id, c.set_name, c.series, min(c.release_date), s.symbol_url
  from public.tcg_cards c
  left join public.tcg_sets s on s.id = c.set_id
  where c.set_id is not null
  group by c.set_id, c.set_name, c.series, s.symbol_url
  order by min(c.release_date), c.set_name;
$$;

-- -------------------------------------------------------------------------------------
-- The bounds of every numeric filter, as one row.
--
-- One call rather than eighteen: the app needs all of them at once to draw its sliders,
-- and none of them change between syncs.
-- -------------------------------------------------------------------------------------
create or replace function public.meta_ranges()
returns json language sql stable set search_path = '' as $$
  select json_build_object(
    'minHeight', min(p.height), 'maxHeight', max(p.height),
    'minWeight', min(p.weight), 'maxWeight', max(p.weight),
    'minBaseExperience', min(p.base_experience), 'maxBaseExperience', max(p.base_experience),
    'minHp', min(s.hp), 'maxHp', max(s.hp),
    'minAttack', min(s.attack), 'maxAttack', max(s.attack),
    'minDefense', min(s.defense), 'maxDefense', max(s.defense),
    'minSpecialAttack', min(s.special_attack), 'maxSpecialAttack', max(s.special_attack),
    'minSpecialDefense', min(s.special_defense), 'maxSpecialDefense', max(s.special_defense),
    'minSpeed', min(s.speed), 'maxSpeed', max(s.speed)
  )
  from public.pokemon p left join public.stats s on s.pokemon_id = p.id;
$$;

-- =====================================================================================
-- Access: readable by anyone holding a session, including the anonymous one a visitor
-- gets on arrival. Not granted to the signed-out role, which keeps the rule from
-- 0003 and 0005 — there is no endpoint a stranger can reach without an account.
-- =====================================================================================
do $grants$
declare
  f text;
begin
  for f in
    select unnest(array[
      'meta_pokemon_types()', 'meta_abilities()', 'meta_generations()',
      'meta_card_types()', 'meta_rarities()', 'meta_supertypes()',
      'meta_illustrators()', 'meta_series()', 'meta_expansions()', 'meta_ranges()'
    ])
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end
$grants$;
