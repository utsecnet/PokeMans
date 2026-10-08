-- Price each copy once.
--
-- entry_price is a function call that reaches into price_latest, and both collection reads
-- invoked it twice for every entry. collection_overview asked for a box's total value and
-- its count of unpriced copies as two separate subqueries over the same rows; collection_box
-- called it for the price and then again purely to decide whether to attach a currency.
--
-- A box of five hundred copies therefore did a thousand lookups to answer five hundred
-- questions, on a page that loads whenever anybody opens their collection.
--
-- Both now compute it once in a lateral and read the result twice, which is what was meant.

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
          -- Both figures from one pass. They were two subqueries over the same rows,
          -- each calling entry_price per entry, so every copy in a box was priced twice
          -- to answer two halves of one question.
          coalesce(priced.total, 0) as "valueUsd",
          coalesce(priced.unpriced, 0) as unpriced,
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
        left join lateral (
          select round(sum(ep.price)::numeric, 2) as total,
                 count(*) filter (where ep.price is null) as unpriced
          from public.collection_entries e
          cross join lateral (select public.entry_price(e.card_id, e.variant_position) as price) ep
          where e.box_id = box.id
        ) priced on true
      ) b
    ), '[]'::json),
    'lastUsedBoxId', (select value::bigint from public.user_settings
                       where key = 'last_used_box_id'),
    'pricesUpdatedAt', (select max(observed_on)::timestamptz from public.price_latest)
  );
$$;

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
             ep.price,
             -- From the source that quoted it rather than a literal. There is one source
             -- today and it is USD, but a hard-coded currency is how a figure ends up
             -- labelled in money it was never denominated in.
             case when ep.price is null then null
                  else (select ps.currency from public.price_source ps order by ps.id limit 1)
             end as "priceCurrency",
          coalesce((
            select json_agg(json_build_object(
                     'position', v.position, 'type', v.type, 'subtype', v.subtype,
                     'stamp', v.stamp, 'size', v.size, 'foil', v.foil)
                   order by v.position)
            from public.tcg_card_variants v where v.card_id = c.id
          ), '[]'::json) as printings
        from public.collection_entries e
        cross join lateral (
          -- Once per copy. It was called twice: for the price, then again only to decide
          -- whether to attach a currency to it.
          select public.entry_price(e.card_id, e.variant_position) as price
        ) ep
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
