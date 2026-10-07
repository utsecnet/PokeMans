-- Repoint the collection summary at the new price table.
--
-- collection_overview still read price_current for the "prices updated" stamp, and that
-- table was dropped when the price model was rebuilt. Every collection page therefore
-- failed outright with "relation public.price_current does not exist" -- not a degraded
-- figure, the whole query.
--
-- entry_price was rewritten at the time and this was missed because nothing here is typed:
-- a function body is just text to Postgres until it runs, so dropping a table a function
-- mentions breaks it silently and only at the next call.
--
-- observed_on rather than captured_on, to match what the label means. A collection's prices
-- were "updated" when a run last looked at them, not when one of them last moved.

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
    'pricesUpdatedAt', (select max(observed_on)::timestamptz from public.price_latest)
  );
$$;
