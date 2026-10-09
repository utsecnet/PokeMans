-- Stop sending image addresses the browser throws away.
--
-- Three columns on tcg_cards hold absolute URLs: image_small and image_large from
-- pokemontcg.io, image_webp from TCGdex. Every card query coalesced two of them together
-- and shipped the result, and the first thing the client did on arrival was overwrite it:
--
--     row.imageSmall = localCard(id)        -- public/cards/<id>.avif
--     row.imageLarge = localCardLarge(id)   -- public/cards-hi/<id>.avif
--
-- Nothing has rendered a stored URL since the card images were vendored onto the device.
-- The cost is 130 bytes a card and 21% of the payload of every card query -- 7,782 of
-- 36,425 bytes on a page of sixty -- for a value discarded before it is read.
--
-- The key stays, set to null. That is the trap here: localiseCard only rewrites a field
-- that is already present, `if ('imageSmall' in row)`, so a function that stopped returning
-- the key would leave the client nothing to replace and break every card image on the site.
-- pokemon_detail has worked this way since it was ported, and is the pattern followed here.
--
-- The columns stay for now. Dropping them is the irreversible half and wants the app seen
-- working first. tcgdex_id, which price capture depends on, is a separate column and is not
-- affected either way.

create or replace function public.search_cards(
  p_search       text    default null,
  p_expansions   text[]  default null,
  p_series       text[]  default null,
  p_rarities     text[]  default null,
  p_types        text[]  default null,
  p_generations  text[]  default null,
  p_supertypes   text[]  default null,
  p_illustrators text[]  default null,
  p_owned        boolean default null,
  p_sort         text    default null,
  p_page         integer default 1,
  p_page_size    integer default 60
)
returns json
language plpgsql
stable
-- `invoker`, emphatically. A security definer function would run as its owner and the
-- EXISTS against collection_entries would then see *everyone's* collections, so the owned
-- filter would leak which cards other people hold. As invoker, row level security applies
-- to the caller exactly as it would anywhere else.
security invoker
set search_path = ''
as $$
declare
  v_page      integer := greatest(1, coalesce(p_page, 1));
  -- 25000 matches the server: the advanced search bar fetches everything and filters in
  -- the browser once a query uses operators that cannot be pushed down to SQL.
  v_size      integer := least(25000, greatest(1, coalesce(p_page_size, 60)));
  v_search    text    := case when nullif(trim(coalesce(p_search, '')), '') is null
                               then null else '%' || lower(trim(p_search)) || '%' end;
  v_order     text    := '';
  v_part      text;
  v_field     text;
  v_dir       text;
  v_items     json;
begin
  -- The sort chain arrives as "field:dir,field:dir". Each field is looked up in a fixed
  -- list and each direction reduced to ASC or DESC, so nothing from the caller is ever
  -- concatenated into the statement — the only strings that reach it are the literals
  -- below.
  if p_sort is not null and p_sort <> '' then
    foreach v_part in array string_to_array(p_sort, ',') loop
      v_field := split_part(trim(v_part), ':', 1);
      v_dir   := case when upper(split_part(trim(v_part), ':', 2)) = 'DESC' then 'DESC' else 'ASC' end;
      v_field := case v_field
        when 'releaseDate'    then 'c.release_date'
        when 'name'           then 'c.name'
        when 'setName'        then 'c.set_name'
        when 'number'         then 'public.card_number_sort(c.number)'
        when 'rarity'         then 'c.rarity'
        when 'pokedexNumber'  then 'pk.national_dex_number'
        when 'pokemonName'    then 'pk.name'
        else null
      end;
      if v_field is not null then
        v_order := v_order || v_field || ' ' || v_dir || ' nulls last, ';
      end if;
    end loop;
  end if;

  if v_order = '' then
    v_order := 'c.release_date ASC nulls last, ';
  end if;
  -- The server's tiebreakers, so two cards never swap places between identical requests.
  v_order := v_order || 'c.set_name ASC, public.card_number_sort(c.number) ASC nulls last, c.id ASC';

  -- A CTE rather than a temporary table. The obvious way to use the match set twice —
  -- once to count, once to page — is to materialise it, but CREATE TABLE AS is a write,
  -- and a function that writes must be declared `volatile`. This function reads and
  -- nothing else, so it stays `stable` and the match set lives in a CTE instead.
  --
  -- Only the ORDER BY is interpolated, and every fragment of it came from the fixed list
  -- above. The filters travel as bound parameters through USING, so no caller-supplied
  -- value is ever part of the statement text.
  execute format($q$
    with matches as (
      select c.id
      from public.tcg_cards c
      left join public.pokemon pk
        on pk.id = (select min(tcp.pokemon_id) from public.tcg_card_pokemon tcp where tcp.card_id = c.id)
      where
            ($1 is null or lower(c.name) like $1 or lower(pk.name) like $1)
        and ($2 is null or cardinality($2) = 0 or c.set_id      = any($2))
        and ($3 is null or cardinality($3) = 0 or c.series      = any($3))
        and ($4 is null or cardinality($4) = 0 or c.rarity      = any($4))
        and ($5 is null or cardinality($5) = 0 or c.supertype   = any($5))
        and ($6 is null or cardinality($6) = 0 or c.illustrator = any($6))
        and ($7 is null or cardinality($7) = 0 or exists (
              select 1 from public.tcg_card_types ct
              where ct.card_id = c.id and ct.type = any($7)))
        and ($8 is null or cardinality($8) = 0 or exists (
              select 1 from public.tcg_card_pokemon tcp
              join public.pokemon p2 on p2.id = tcp.pokemon_id
              where tcp.card_id = c.id and p2.generation = any($8)))
        and ($9 is null or $9 = exists (
              select 1 from public.collection_entries ce where ce.card_id = c.id))
    ),
    page as (
      select
        c.id, c.name, c.number,
        c.set_id   as "setId",
        c.set_name as "setName",
        c.series, c.rarity,
        c.release_date as "releaseDate",
        null as "imageSmall",
        null as "imageLarge",
        c.supertype, c.illustrator,
        sr.logo_url    as "seriesLogoUrl",
        st.symbol_url  as "setSymbolUrl",
        st.logo_url    as "setLogoUrl",
        pk.id          as "pokemonId",
        pk.name        as "pokemonName",
        coalesce((select array_agg(ct.type order by ct.slot)
                  from public.tcg_card_types ct where ct.card_id = c.id), '{}') as types,
        coalesce((
          select json_agg(json_build_object(
                   'entryId', e.newest, 'boxId', e.box_id,
                   'boxName', e.box_name, 'quantity', e.copies)
                 order by e.box_name)
          from (
            select ce.box_id, b.name as box_name,
                   max(ce.id) as newest, count(*) as copies
            from public.collection_entries ce
            join public.collection_boxes b on b.id = ce.box_id
            where ce.card_id = c.id
            group by ce.box_id, b.name
          ) e
        ), '[]'::json) as "inBoxes",
        exists (select 1 from public.collection_entries ce where ce.card_id = c.id) as owned,
        row_number() over (order by %1$s) as rn
      from public.tcg_cards c
      join matches m on m.id = c.id
      left join public.pokemon pk
        on pk.id = (select min(tcp.pokemon_id) from public.tcg_card_pokemon tcp where tcp.card_id = c.id)
      left join public.tcg_series sr on sr.name = c.series
      left join public.tcg_sets   st on st.id   = c.set_id
      order by %1$s
      limit %2$s offset %3$s
    )
    select json_build_object(
      'items', coalesce((select json_agg(to_jsonb(p) - 'rn' order by p.rn) from page p), '[]'::json),
      'total', (select count(*) from matches)
    )
  $q$, v_order, v_size, (v_page - 1) * v_size)
  into v_items
  using v_search, p_expansions, p_series, p_rarities, p_supertypes,
        p_illustrators, p_types, p_generations, p_owned;

  return json_build_object(
    'items', v_items -> 'items',
    'total', v_items -> 'total',
    'page', v_page,
    'pageSize', v_size
  );
end;
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
          null as "imageSmall",
          null as "imageLarge",
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
          null as "imageSmall",
          null as "imageLarge",
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
