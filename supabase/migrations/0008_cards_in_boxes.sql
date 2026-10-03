-- =====================================================================================
-- PokéMans — which of your boxes each card is in
--
-- search_cards returned `owned`, a boolean, which is enough to filter on but not enough
-- to draw with: the card grid shows a badge naming the boxes a card sits in, and the card
-- view lists them. Without the field the badge component read undefined.length and took
-- the page down with it.
--
-- `inBoxes` is one entry per box, not per copy. Owning three of a card in one box is one
-- line reading three, not the same box listed three times; entryId keeps the newest copy,
-- which is the one a tap removes. That folding is what server/src/lib/collectionInfo.js
-- did in JavaScript after the query, and it is a GROUP BY here.
--
-- Both tables it reads are personal, and the function is security invoker, so row level
-- security scopes them to the caller. Two people looking at the same card see their own
-- boxes and never learn of each other's.
--
-- Replaces the definition in 0007. Idempotent.
-- =====================================================================================

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
        coalesce(c.image_webp, c.image_small) as "imageSmall",
        c.image_large  as "imageLarge",
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

revoke all on function public.search_cards(text, text[], text[], text[], text[], text[], text[], text[], boolean, text, integer, integer) from public, anon;
grant execute on function public.search_cards(text, text[], text[], text[], text[], text[], text[], text[], boolean, text, integer, integer) to authenticated, service_role;
