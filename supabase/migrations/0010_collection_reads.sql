-- =====================================================================================
-- PokéMans — reading a collection
--
-- Replaces GET /api/collection/boxes and GET /api/collection/boxes/:id. The writes need
-- no function: creating a box, filing a card, renaming, reordering and deleting are plain
-- table operations, and the policies from 0001 already confine them to the caller's rows.
--
-- Both functions are security invoker, so row level security applies to the caller. They
-- never take a user id and never learn one — two people calling collection_overview() get
-- their own boxes from the same code.
--
-- Run in the Supabase SQL editor, or via `supabase db push`. Idempotent.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- entry_price — the current price of one filed copy, or null.
--
-- The server read this from card_price_history with a correlated subquery picking the
-- latest capture per card and printing. price_current holds exactly that by construction,
-- so here it is a primary-key lookup.
--
-- A copy with no printing recorded is deliberately unpriced rather than guessed. The same
-- card in Unlimited and 1st Edition can differ roughly sevenfold, so picking one would not
-- be an approximation, it would be a number with no meaning.
-- -------------------------------------------------------------------------------------
create or replace function public.entry_price(p_card_id text, p_variant integer)
returns numeric language sql stable set search_path = '' as $$
  select pc.market
  from public.price_current pc
  where p_variant is not null
    and pc.card_id = p_card_id
    and pc.variant_position = p_variant
    and pc.source = 'tcgplayer'
    and pc.market is not null
  limit 1;
$$;

-- -------------------------------------------------------------------------------------
-- collection_overview — every box, with what it holds and what it is worth.
-- -------------------------------------------------------------------------------------
create or replace function public.collection_overview()
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select json_build_object(
    'boxes', coalesce((
      select json_agg(b order by b.sort_null, b.position, b."createdAt")
      from (
        select
          box.id, box.name, box.type, box.color, box.icon, box.position,
          box.created_at as "createdAt",
          -- Distinct cards, against total copies: a box holding three of one card shows
          -- one card and three copies.
          (select count(distinct e.card_id) from public.collection_entries e
            where e.box_id = box.id) as "cardCount",
          (select count(*) from public.collection_entries e
            where e.box_id = box.id) as "totalQuantity",
          coalesce((select round(sum(public.entry_price(e.card_id, e.variant_position))::numeric, 2)
                    from public.collection_entries e where e.box_id = box.id), 0) as "valueUsd",
          -- Copies still needing a printing chosen before they can be valued.
          (select count(*) from public.collection_entries e
            where e.box_id = box.id
              and public.entry_price(e.card_id, e.variant_position) is null) as unpriced,
          -- A few cards so a tile can show what is in it rather than an icon standing for
          -- it. Distinct cards, oldest first, capped at four: beyond that a fanned tile
          -- stops being legible.
          coalesce((
            select array_agg(p.card_id order by p.first_added)
            from (
              select e.card_id, min(e.id) as first_added
              from public.collection_entries e
              where e.box_id = box.id
              group by e.card_id
              order by min(e.id)
              limit 4
            ) p
          ), '{}') as preview,
          -- The user's own order first; a box never placed falls to the end in creation
          -- order rather than jumping to the front on a null.
          (box.position is null) as sort_null
        from public.collection_boxes box
      ) b
    ), '[]'::json),
    'lastUsedBoxId', (select value::bigint from public.user_settings
                       where key = 'last_used_box_id'),
    'pricesUpdatedAt', (select max(updated_at) from public.price_current)
  );
$$;

-- -------------------------------------------------------------------------------------
-- collection_box — one box and everything filed in it.
--
-- The server could not do this in one query: collections lived in a separate SQLite file
-- from the catalogue, so it read the entries, then looked each card up in the other
-- database and stitched them together in JavaScript. One database, one join.
--
-- Printings travel with each entry so the interface can offer exactly the ones this card
-- was printed in, rather than a fixed list that might include a reverse holo for a card
-- that never had one. They are returned raw: the readable label ("Holo · Shadowless · 1st
-- Edition") is built in the client, because it is presentation, and the title-casing rule
-- behind it does not belong in SQL.
-- -------------------------------------------------------------------------------------
create or replace function public.collection_box(p_box_id bigint)
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select case when box.id is null then null else json_build_object(
    'id', box.id, 'name', box.name, 'type', box.type, 'color', box.color,
    'createdAt', box.created_at,
    'entries', coalesce((
      select json_agg(x order by x.added_at desc, x.id desc)
      from (
        select
          e.id, e.card_id as "cardId", e.added_at,
          e.variant_position as "variantPosition",
          c.name, c.number,
          c.set_id   as "setId",
          c.set_name as "setName",
          c.series, c.rarity,
          coalesce(c.image_webp, c.image_small) as "imageSmall",
          c.image_large as "imageLarge",
          (select p.id   from public.tcg_card_pokemon tcp join public.pokemon p on p.id = tcp.pokemon_id
            where tcp.card_id = c.id limit 1) as "pokemonId",
          (select p.name from public.tcg_card_pokemon tcp join public.pokemon p on p.id = tcp.pokemon_id
            where tcp.card_id = c.id limit 1) as "pokemonName",
          public.entry_price(e.card_id, e.variant_position) as price,
          case when public.entry_price(e.card_id, e.variant_position) is null
               then null else 'USD' end as "priceCurrency",
          coalesce((
            select json_agg(json_build_object(
                     'position', v.position, 'type', v.type, 'subtype', v.subtype,
                     'stamp', v.stamp, 'size', v.size, 'foil', v.foil)
                   order by v.position)
            from public.tcg_card_variants v where v.card_id = c.id
          ), '[]'::json) as printings
        from public.collection_entries e
        -- An inner join, matching the server: an entry whose card vanished from the
        -- catalogue in a resync is skipped rather than drawn broken. There is no foreign
        -- key from entries into the catalogue to prevent that happening.
        join public.tcg_cards c on c.id = e.card_id
        where e.box_id = p_box_id
      ) x
    ), '[]'::json)
  ) end
  from (select * from public.collection_boxes where id = p_box_id) box
  right join (select 1) dummy on true;
$$;

revoke all on function public.entry_price(text, integer) from public, anon;
revoke all on function public.collection_overview() from public, anon;
revoke all on function public.collection_box(bigint) from public, anon;
grant execute on function public.entry_price(text, integer) to authenticated, service_role;
grant execute on function public.collection_overview() to authenticated, service_role;
grant execute on function public.collection_box(bigint) to authenticated, service_role;
