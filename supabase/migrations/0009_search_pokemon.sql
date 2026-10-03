-- =====================================================================================
-- PokéMans — the Pokédex browser's query
--
-- Replaces GET /api/pokemon. Ported from server/src/routes/pokemon.js.
--
-- Run in the Supabase SQL editor, or via `supabase db push`. Idempotent.
-- =====================================================================================

create or replace function public.search_pokemon(
  p_search      text    default null,
  p_types       text[]  default null,
  -- 'any' matches a Pokémon with any of the chosen types; 'all' requires all of them, so
  -- Fire+Flying finds Charizard and not every Fire type.
  p_type_mode   text    default 'any',
  p_generations text[]  default null,
  p_abilities   text[]  default null,
  p_expansions  text[]  default null,
  -- The nine numeric filters as one object, rather than eighteen min/max parameters:
  --   {"hp": {"min": 1, "max": 255}, "height": {...}, ...}
  -- Keys are the names the client already uses; anything absent is not filtered on.
  p_ranges      jsonb   default null,
  p_sort        text    default null,
  p_page        integer default 1,
  p_page_size   integer default 60
)
returns json
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_page   integer := greatest(1, coalesce(p_page, 1));
  v_size   integer := least(25000, greatest(1, coalesce(p_page_size, 60)));
  v_search text    := case when nullif(trim(coalesce(p_search, '')), '') is null
                            then null else '%' || lower(trim(p_search)) || '%' end;
  v_order  text    := '';
  v_part   text;
  v_field  text;
  v_dir    text;
  v_result json;
begin
  if p_sort is not null and p_sort <> '' then
    foreach v_part in array string_to_array(p_sort, ',') loop
      v_field := split_part(trim(v_part), ':', 1);
      v_dir   := case when upper(split_part(trim(v_part), ':', 2)) = 'DESC' then 'DESC' else 'ASC' end;
      v_field := case v_field
        when 'dex'            then 'p.national_dex_number'
        when 'name'           then 'p.name'
        when 'hp'             then 's.hp'
        when 'attack'         then 's.attack'
        when 'defense'        then 's.defense'
        when 'specialAttack'  then 's.special_attack'
        when 'specialDefense' then 's.special_defense'
        when 'speed'          then 's.speed'
        when 'height'         then 'p.height'
        when 'weight'         then 'p.weight'
        when 'baseExperience' then 'p.base_experience'
        -- Counted inline so the list can be ordered by it. A count attached after the
        -- page is cut cannot be sorted on, because ordering has to happen first.
        when 'cardCount'      then '(select count(distinct tcp.card_id)
                                     from public.tcg_card_pokemon tcp where tcp.pokemon_id = p.id)'
        else null
      end;
      if v_field is not null then
        v_order := v_order || v_field || ' ' || v_dir || ' nulls last, ';
      end if;
    end loop;
  end if;

  if v_order = '' then
    v_order := 'p.national_dex_number ASC, ';
  end if;
  v_order := v_order || 'p.national_dex_number ASC';

  execute format($q$
    with matches as (
      select p.id
      from public.pokemon p
      left join public.stats s on s.pokemon_id = p.id
      where
        -- Alternate forms are excluded throughout. The dex is a list of species; a
        -- Galarian form is the same species wearing a different coat.
            p.is_default_variety
        and ($1 is null or lower(p.name) like $1)
        and ($2 is null or cardinality($2) = 0 or p.generation = any($2))
        and ($3 is null or cardinality($3) = 0 or (
              case when $4 = 'all' then
                (select count(distinct t.name)
                 from public.pokemon_types pt join public.types t on t.id = pt.type_id
                 where pt.pokemon_id = p.id and t.name = any($3)) = cardinality($3)
              else
                exists (select 1
                        from public.pokemon_types pt join public.types t on t.id = pt.type_id
                        where pt.pokemon_id = p.id and t.name = any($3))
              end))
        and ($5 is null or cardinality($5) = 0 or exists (
              select 1 from public.pokemon_abilities pa
              join public.abilities a on a.id = pa.ability_id
              where pa.pokemon_id = p.id and a.name = any($5)))
        and ($6 is null or cardinality($6) = 0 or exists (
              select 1 from public.tcg_card_pokemon tcp
              join public.tcg_cards c on c.id = tcp.card_id
              where tcp.pokemon_id = p.id and c.set_id = any($6)))
        -- Each range is applied only when present, and only against rows that have a
        -- value: a null stat is unknown, not zero, and must not be filtered out by a
        -- minimum it cannot be compared to.
        and ($7 is null or (
              ($7->'hp'             is null or s.hp               between ($7->'hp'->>'min')::numeric             and ($7->'hp'->>'max')::numeric)
          and ($7->'attack'         is null or s.attack           between ($7->'attack'->>'min')::numeric         and ($7->'attack'->>'max')::numeric)
          and ($7->'defense'        is null or s.defense          between ($7->'defense'->>'min')::numeric        and ($7->'defense'->>'max')::numeric)
          and ($7->'specialAttack'  is null or s.special_attack   between ($7->'specialAttack'->>'min')::numeric  and ($7->'specialAttack'->>'max')::numeric)
          and ($7->'specialDefense' is null or s.special_defense  between ($7->'specialDefense'->>'min')::numeric and ($7->'specialDefense'->>'max')::numeric)
          and ($7->'speed'          is null or s.speed            between ($7->'speed'->>'min')::numeric          and ($7->'speed'->>'max')::numeric)
          and ($7->'height'         is null or p.height           between ($7->'height'->>'min')::numeric         and ($7->'height'->>'max')::numeric)
          and ($7->'weight'         is null or p.weight           between ($7->'weight'->>'min')::numeric         and ($7->'weight'->>'max')::numeric)
          and ($7->'baseExperience' is null or p.base_experience  between ($7->'baseExperience'->>'min')::numeric and ($7->'baseExperience'->>'max')::numeric)
        ))
    ),
    page as (
      select
        p.id,
        p.national_dex_number as "nationalDexNumber",
        p.name, p.generation,
        p.sprite_url   as "spriteUrl",
        p.artwork_url  as "artworkUrl",
        p.height, p.weight,
        p.base_experience as "baseExperience",
        s.hp, s.attack, s.defense,
        s.special_attack  as "specialAttack",
        s.special_defense as "specialDefense",
        s.speed,
        coalesce((select array_agg(t.name order by pt.slot)
                  from public.pokemon_types pt join public.types t on t.id = pt.type_id
                  where pt.pokemon_id = p.id), '{}') as types,
        -- A total across every expansion, on purpose: it answers "how much card art
        -- exists for this Pokémon", so it must not shrink when the expansion filter
        -- narrows the view.
        (select count(distinct tcp.card_id)
         from public.tcg_card_pokemon tcp where tcp.pokemon_id = p.id) as "cardCount",
        row_number() over (order by %1$s) as rn
      from public.pokemon p
      join matches m on m.id = p.id
      left join public.stats s on s.pokemon_id = p.id
      order by %1$s
      limit %2$s offset %3$s
    )
    select json_build_object(
      'items', coalesce((select json_agg(to_jsonb(x) - 'rn' order by x.rn) from page x), '[]'::json),
      'total', (select count(*) from matches)
    )
  $q$, v_order, v_size, (v_page - 1) * v_size)
  into v_result
  using v_search, p_generations, p_types, coalesce(p_type_mode, 'any'),
        p_abilities, p_expansions, p_ranges;

  return json_build_object(
    'items', v_result -> 'items',
    'total', v_result -> 'total',
    'page', v_page,
    'pageSize', v_size
  );
end;
$$;

revoke all on function public.search_pokemon(text, text[], text, text[], text[], text[], jsonb, text, integer, integer) from public, anon;
grant execute on function public.search_pokemon(text, text[], text, text[], text[], text[], jsonb, text, integer, integer) to authenticated, service_role;
