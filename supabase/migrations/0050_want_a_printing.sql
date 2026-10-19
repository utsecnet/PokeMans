-- =====================================================================================
-- PokéMans — wanting a particular printing
--
-- Issue #2. A want list entry held a card id and nothing else, so it could say "I want
-- Charizard" and not "I want the holofoil". Worse, the holofoil a collector is actually
-- hunting counted as found the moment any copy of that card appeared in any collection,
-- which is the opposite of what a want list is for.
--
-- One nullable column, and the two reads that interpret it. Null keeps exactly today's
-- meaning: any printing will do, and owning any copy settles it. A position names one
-- printing of that card, and then only that printing settles it — a card stays wanted
-- until the exact printing turns up.
--
-- Note what is NOT here: the one-card-per-list constraint is untouched. A list still
-- holds a given card once, and that entry now carries which printing is wanted. Wanting
-- two printings of one card on one list would mean a second row and a wider unique
-- constraint, and nothing has asked for it.
--
-- Run in the Supabase SQL editor, or via `supabase db push`. Idempotent.
-- =====================================================================================

alter table public.want_list_entries
  add column if not exists variant_position integer;

comment on column public.want_list_entries.variant_position is
  'Which printing is wanted, as a position in tcg_card_variants for this card. '
  'Null means any printing will do, which is what every row predating issue #2 holds.';

-- -------------------------------------------------------------------------------------
-- want_lists_overview — every list, with progress.
--
-- Unchanged except for what counts as owned. A copy whose own printing is unrecorded does
-- not settle a want that names one: "printing not set" is a copy nobody has identified,
-- and treating it as the wanted printing would mark a card found on a guess. Copies filed
-- since migration 0049 carry the cheapest printing by default, so this is mostly about
-- older rows.
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
                         where ce.card_id = w.card_id
                           and (w.variant_position is null
                                or ce.variant_position = w.variant_position))) as "ownedCount",
        -- A few cards, each carrying whether it is already owned. The detail page draws
        -- an owned card in colour and a missing one in grey; the tile does the same, so
        -- the preview is the progress bar rather than an illustration sitting above one.
        coalesce((
          select json_agg(json_build_object('cardId', p.card_id, 'owned', p.owned)
                 order by p.id)
          from (
            select w.id, w.card_id,
                   exists (select 1 from public.collection_entries ce
                            where ce.card_id = w.card_id
                              and (w.variant_position is null
                                   or ce.variant_position = w.variant_position)) as owned
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
-- Each card now carries its entry id, the printing wanted, and the printings that card
-- was published in, which is the same trio collection_box hands its entries. The client
-- draws the identical control from it.
--
-- inBoxes narrows the same way. It is what the page reads to decide a card is in hand, so
-- a want for the holofoil shows the boxes holding the holofoil and not the ones holding a
-- normal copy — otherwise the card would read as found while the collector is still
-- looking for it.
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
          w.id as "entryId",
          w.variant_position as "variantPosition",
          c.id, c.name, c.number,
          c.set_id   as "setId",
          c.set_name as "setName",
          c.series, c.rarity, c.supertype, c.illustrator,
          c.release_date as "releaseDate",
          -- Null since 0047, and the keys stay: the client names the image file from the
          -- card id and only rewrites a key that is already present. The columns these
          -- once read were dropped in 0048, so a body copied from 0011 will not compile.
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

revoke all on function public.want_lists_overview() from public, anon;
revoke all on function public.want_list(bigint) from public, anon;
grant execute on function public.want_lists_overview() to authenticated, service_role;
grant execute on function public.want_list(bigint) to authenticated, service_role;
