-- =====================================================================================
-- PokéMans — wanting more than one printing of a card
--
-- The follow-up 0050 named. A want list held a given card once, so naming a printing on
-- that entry meant choosing between them: asking for the Shadowless Charizard gave up
-- asking for the Unlimited one. A collector after both had no way to say so.
--
-- The one-card-per-list constraint becomes one-printing-per-list. The same card may sit on
-- a list several times as long as each row wants a different printing, and still only once
-- per printing -- including the open "any printing" row, which coalesce folds to a value no
-- position can take so that two of those still collide.
--
-- Run in the Supabase SQL editor, or via `supabase db push`. Idempotent.
-- =====================================================================================

alter table public.want_list_entries
  drop constraint if exists want_list_entries_card_once;

-- A unique index rather than a constraint, because the rule is about an expression: null is
-- "any printing", one specific thing, and Postgres treats nulls in a unique constraint as
-- distinct from each other, which would let a list hold the same open want twice.
create unique index if not exists want_list_entries_card_printing_once
  on public.want_list_entries (list_id, card_id, coalesce(variant_position, -1));

-- -------------------------------------------------------------------------------------
-- want_lists_overview — every list, with progress.
--
-- Two counting changes, both from the same cause: a card can now occupy more than one row.
--
-- ownedCount counted distinct cards while wantedCount counted rows, which was the same
-- number until today and is not any more. A list wanting two printings of one card and
-- holding one of them is one of two found, not one of one. Both count rows now, so the
-- progress bar and the figure beside it answer the same question.
--
-- The preview still shows four distinct cards. Two rows of one card are two wants but one
-- picture, and the same face twice in a row of four reads as a bug.
-- -------------------------------------------------------------------------------------
create or replace function public.want_lists_overview()
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select json_build_object('lists', coalesce((
    select json_agg(x order by x.name)
    from (
      select
        l.id, l.name, l.color, l.query, l.live,
        l.last_synced_at as "lastSyncedAt",
        l.created_at     as "createdAt",
        (select count(*) from public.want_list_entries w
          where w.list_id = l.id and w.state = 'want') as "wantedCount",
        (select count(*) from public.want_list_entries w
          where w.list_id = l.id and w.state = 'want'
            and exists (select 1 from public.collection_entries ce
                         where ce.card_id = w.card_id
                           and (w.variant_position is null
                                or ce.variant_position = w.variant_position))) as "ownedCount",
        -- A few cards, each carrying whether it is already owned. The detail page draws
        -- an owned card in colour and a missing one in grey; the tile does the same, so
        -- the preview is the progress bar rather than an illustration sitting above one.
        --
        -- A card wanted in two printings shows its earliest row, and counts as found only
        -- when that row is: a face that is half found cannot be drawn half in colour.
        coalesce((
          select json_agg(json_build_object('cardId', p.card_id, 'owned', p.owned)
                 order by p.id)
          from (
            select d.* from (
              select distinct on (w.card_id)
                     w.id, w.card_id,
                     exists (select 1 from public.collection_entries ce
                              where ce.card_id = w.card_id
                                and (w.variant_position is null
                                     or ce.variant_position = w.variant_position)) as owned
              from public.want_list_entries w
              where w.list_id = l.id and w.state = 'want'
              order by w.card_id, w.id
            ) d
            order by d.id
            limit 4
          ) p
        ), '[]'::json) as preview
      from public.want_lists l
    ) x
  ), '[]'::json));
$$;

-- -------------------------------------------------------------------------------------
-- want_list — one list and the cards on it.
--
-- Only the order changes. Cards still come back in the order the list grew, but a card's
-- rows now travel together: the order is when that card first joined the list, then the
-- printing. Sorting by each row's own added_at would file a printing added today at the far
-- end of the list, pages away from the same card's other row, which is the one place a
-- reader needs to see them side by side.
--
-- Nulls first inside a card, because the open want is the one that was there before anybody
-- started narrowing.
-- -------------------------------------------------------------------------------------
create or replace function public.want_list(p_list_id bigint)
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select case when l.id is null then null else json_build_object(
    'id', l.id, 'name', l.name, 'color', l.color, 'query', l.query, 'live', l.live,
    'lastSyncedAt', l.last_synced_at,
    'createdAt', l.created_at,
    'cards', coalesce((
      select json_agg(x order by x.card_first_added, x."cardId",
                      x."variantPosition" nulls first)
      from (
        select
          w.added_at, w.card_id as "cardId",
          min(w.added_at) over (partition by w.card_id) as card_first_added,
          w.id as "entryId",
          w.variant_position as "variantPosition",
          c.id, c.name, c.number,
          c.set_id   as "setId",
          c.set_name as "setName",
          c.series, c.rarity, c.supertype, c.illustrator,
          c.release_date as "releaseDate",
          -- Null since 0047, and the keys stay: the client names the image file from the
          -- card id and only rewrites a key that is already present.
          null as "imageSmall",
          null as "imageLarge",
          (select p.id   from public.tcg_card_pokemon tcp join public.pokemon p on p.id = tcp.pokemon_id
            where tcp.card_id = c.id order by p.id limit 1) as "pokemonId",
          (select p.name from public.tcg_card_pokemon tcp join public.pokemon p on p.id = tcp.pokemon_id
            where tcp.card_id = c.id order by p.id limit 1) as "pokemonName",
          coalesce((
            select json_agg(json_build_object(
                     'position', v.position, 'type', v.type, 'subtype', v.subtype,
                     'stamp', v.stamp, 'size', v.size, 'foil', v.foil)
                   order by v.position)
            from public.tcg_card_variants v where v.card_id = c.id
          ), '[]'::json) as printings,
          coalesce((
            select json_agg(json_build_object(
                     'entryId', ce.id, 'boxId', ce.box_id, 'boxName', b.name, 'quantity', 1)
                   order by ce.id)
            from public.collection_entries ce
            join public.collection_boxes b on b.id = ce.box_id
            where ce.card_id = c.id
              and (w.variant_position is null or ce.variant_position = w.variant_position)
          ), '[]'::json) as "inBoxes"
        from public.want_list_entries w
        -- Inner join: a card can vanish from the catalogue between a resync and now, and
        -- is skipped rather than drawn as a hole. Collection entries do the same.
        join public.tcg_cards c on c.id = w.card_id
        where w.list_id = l.id and w.state = 'want'
      ) x
    ), '[]'::json),
    'ownedCount', (
      select count(*) from public.want_list_entries w
      where w.list_id = l.id and w.state = 'want'
        and exists (select 1 from public.collection_entries ce
                     where ce.card_id = w.card_id
                       and (w.variant_position is null
                            or ce.variant_position = w.variant_position))
    )
  ) end
  from (select * from public.want_lists where id = p_list_id) l
  right join (select 1) dummy on true;
$$;

-- -------------------------------------------------------------------------------------
-- wants_by_card — which lists each wanted card is on.
--
-- Distinct, because a card wanted in two printings is on that list once as far as the card
-- browser is concerned. Without it the tile would name the same list twice.
-- -------------------------------------------------------------------------------------
create or replace function public.wants_by_card()
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select json_build_object('byCard', coalesce((
    select json_object_agg(card_id, lists)
    from (
      select g.card_id,
             json_agg(json_build_object('listId', g.list_id, 'listName', g.list_name)
                      order by g.list_name) as lists
      from (
        select distinct w.card_id, l.id as list_id, l.name as list_name
        from public.want_list_entries w
        join public.want_lists l on l.id = w.list_id
        where w.state = 'want'
      ) g
      group by g.card_id
    ) a
  ), '{}'::json));
$$;

revoke all on function public.want_lists_overview() from public, anon;
revoke all on function public.want_list(bigint) from public, anon;
revoke all on function public.wants_by_card() from public, anon;
grant execute on function public.want_lists_overview() to authenticated, service_role;
grant execute on function public.want_list(bigint) to authenticated, service_role;
grant execute on function public.wants_by_card() to authenticated, service_role;
