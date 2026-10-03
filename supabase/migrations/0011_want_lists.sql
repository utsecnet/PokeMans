-- =====================================================================================
-- PokéMans — reading want lists
--
-- Replaces GET /api/wants, GET /api/wants/:id and GET /api/wants/meta/by-card. Adding and
-- removing cards needs no function: they are plain table operations under the policies
-- from 0001.
--
-- A want list crosses the two halves of the schema — it is personal data about shared
-- cards, and it asks "do I already own this?", which reads a second personal table. All
-- three functions are security invoker, so every one of those reads is scoped to the
-- caller by row level security without any of them taking a user id.
--
-- Run in the Supabase SQL editor, or via `supabase db push`. Idempotent.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- want_lists_overview — every list, with progress.
--
-- `state` distinguishes a card someone wants from one they have deliberately excluded, so
-- every count here filters on 'want'. An excluded card is still a row: that is how the
-- list remembers not to re-add it when a live query runs again.
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
        (select count(distinct w.card_id) from public.want_list_entries w
          where w.list_id = l.id and w.state = 'want'
            and exists (select 1 from public.collection_entries ce
                         where ce.card_id = w.card_id)) as "ownedCount",
        -- A few cards, each carrying whether it is already owned. The detail page draws
        -- an owned card in colour and a missing one in grey; the tile does the same, so
        -- the preview is the progress bar rather than an illustration sitting above one.
        coalesce((
          select json_agg(json_build_object('cardId', p.card_id, 'owned', p.owned)
                 order by p.id)
          from (
            select w.id, w.card_id,
                   exists (select 1 from public.collection_entries ce
                            where ce.card_id = w.card_id) as owned
            from public.want_list_entries w
            where w.list_id = l.id and w.state = 'want'
            order by w.id
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
-- Cards come back in the order the list grew, not catalogue order, so it reads the way it
-- was built. Each carries which of your collections already hold it, which is what turns
-- a want list into a checklist.
--
-- Live lists are not refreshed here. Re-running a stored filter means interpreting a
-- query string the client already knows how to build and parse, and a function declared
-- `stable` cannot write the new rows anyway. The client refreshes, then calls this.
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
      select json_agg(x order by x.added_at, x."cardId")
      from (
        select
          w.added_at, w.card_id as "cardId",
          c.id, c.name, c.number,
          c.set_id   as "setId",
          c.set_name as "setName",
          c.series, c.rarity, c.supertype, c.illustrator,
          c.release_date as "releaseDate",
          coalesce(c.image_webp, c.image_small) as "imageSmall",
          c.image_large as "imageLarge",
          (select p.id   from public.tcg_card_pokemon tcp join public.pokemon p on p.id = tcp.pokemon_id
            where tcp.card_id = c.id order by p.id limit 1) as "pokemonId",
          (select p.name from public.tcg_card_pokemon tcp join public.pokemon p on p.id = tcp.pokemon_id
            where tcp.card_id = c.id order by p.id limit 1) as "pokemonName",
          coalesce((
            select json_agg(json_build_object(
                     'entryId', ce.id, 'boxId', ce.box_id, 'boxName', b.name, 'quantity', 1)
                   order by ce.id)
            from public.collection_entries ce
            join public.collection_boxes b on b.id = ce.box_id
            where ce.card_id = c.id
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
        and exists (select 1 from public.collection_entries ce where ce.card_id = w.card_id)
    )
  ) end
  from (select * from public.want_lists where id = p_list_id) l
  right join (select 1) dummy on true;
$$;

-- -------------------------------------------------------------------------------------
-- wants_by_card — which lists each wanted card is on.
--
-- The card browser asks this once and then knows, for every tile it draws, whether that
-- card is on a list and which. Asking per card would be one request per tile.
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
      select w.card_id,
             json_agg(json_build_object('listId', l.id, 'listName', l.name) order by l.name) as lists
      from public.want_list_entries w
      join public.want_lists l on l.id = w.list_id
      where w.state = 'want'
      group by w.card_id
    ) g
  ), '{}'::json));
$$;

revoke all on function public.want_lists_overview() from public, anon;
revoke all on function public.want_list(bigint) from public, anon;
revoke all on function public.wants_by_card() from public, anon;
grant execute on function public.want_lists_overview() to authenticated, service_role;
grant execute on function public.want_list(bigint) to authenticated, service_role;
grant execute on function public.wants_by_card() to authenticated, service_role;
