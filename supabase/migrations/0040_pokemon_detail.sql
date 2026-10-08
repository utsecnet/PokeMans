-- The Pokémon detail page, the last thing still asking the Express server for data.
--
-- It is the largest of the ported reads because it answers seven questions at once: the
-- Pokémon itself, its types, abilities and stats, every card that features it, the other
-- forms sharing its dex number, and the evolution tree it sits in.
--
-- The tree is why this took a function rather than a view. Evolutions are stored as edges,
-- the page wants a nested tree, and the tree has to be rooted at the *start* of the family
-- rather than at the Pokémon being viewed -- opening Charizard shows Charmander at the top.
-- So the root is found by walking edges backwards, then the tree is built forwards.
--
-- No image URLs are returned. The client derives sprite and artwork paths from the id, the
-- same way the list already does, which keeps every image reference going through one
-- function and means nothing here has to know where the files are served from.

/**
 * One node of an evolution tree, with its children beneath it.
 *
 * Recursive, and carries the ids already visited. Evolution data is not guaranteed acyclic
 * -- a bad import or an upstream oddity could point a chain back at itself -- and without
 * the guard that is an infinite recursion rather than a wrong answer.
 *
 * The transition that led here (level, item, trigger) belongs to the edge rather than the
 * Pokémon, so it is passed in by the caller that followed that edge.
 */
create or replace function public.evolution_node(
  p_id        integer,
  p_trigger   text default null,
  p_min_level integer default null,
  p_item      text default null,
  p_seen      integer[] default '{}'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_row   record;
  v_seen  integer[] := p_seen || p_id;
  v_kids  jsonb;
begin
  if p_id = any(p_seen) then
    return null;
  end if;

  select p.id, p.name into v_row from public.pokemon p where p.id = p_id;
  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(child order by (child ->> 'id')::int), '[]'::jsonb)
    into v_kids
  from (
    select public.evolution_node(e.evolves_into_id, e.trigger, e.min_level, e.item, v_seen) as child
    from public.evolutions e
    where e.pokemon_id = p_id
    order by e.evolves_into_id
  ) kids
  where child is not null;

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    -- Sprite and artwork are left out on purpose; the client builds those paths from the id.
    'spriteUrl', null,
    'artworkUrl', null,
    'types', coalesce((
      select jsonb_agg(t.name order by pt.slot)
      from public.pokemon_types pt join public.types t on t.id = pt.type_id
      where pt.pokemon_id = p_id
    ), '[]'::jsonb),
    'trigger', p_trigger,
    'minLevel', p_min_level,
    'item', p_item,
    'children', v_kids
  );
end;
$$;

/**
 * The whole family tree a Pokémon belongs to, rooted at its earliest form.
 *
 * Walks edges backwards to find the start -- opening Charizard should show the chain from
 * Charmander, not a stump beginning at Charizard -- then builds downwards from there. The
 * path array stops a cycle turning the walk into a loop.
 */
create or replace function public.evolution_chain_for(p_id integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive upwards as (
    select p_id as id, 0 as depth, array[p_id] as path
    union all
    select e.pokemon_id, u.depth + 1, u.path || e.pokemon_id
    from upwards u
    join public.evolutions e on e.evolves_into_id = u.id
    where not (e.pokemon_id = any(u.path))
  )
  select public.evolution_node((select id from upwards order by depth desc, id limit 1));
$$;

/**
 * Everything the detail page shows for one Pokémon.
 *
 * security invoker so the collection figures on each card are the caller's own: inBoxes
 * reads collection_entries, which row level security scopes to whoever is asking. Two
 * people opening the same Pokémon see the same cards and their own copies.
 */
create or replace function public.pokemon_detail(p_id integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id,
    'nationalDexNumber', p.national_dex_number,
    'name', p.name,
    'generation', p.generation,
    'height', p.height,
    'weight', p.weight,
    'baseExperience', p.base_experience,
    'flavorText', p.flavor_text,
    'spriteUrl', null,
    'artworkUrl', null,
    'isDefaultVariety', p.is_default_variety,
    'variantLabel', p.variant_label,

    'types', coalesce((
      select jsonb_agg(t.name order by pt.slot)
      from public.pokemon_types pt join public.types t on t.id = pt.type_id
      where pt.pokemon_id = p.id
    ), '[]'::jsonb),

    'abilities', coalesce((
      select jsonb_agg(jsonb_build_object('name', a.name, 'isHidden', pa.is_hidden) order by pa.slot)
      from public.pokemon_abilities pa join public.abilities a on a.id = pa.ability_id
      where pa.pokemon_id = p.id
    ), '[]'::jsonb),

    'stats', (
      select jsonb_build_object(
        'hp', s.hp, 'attack', s.attack, 'defense', s.defense,
        'specialAttack', s.special_attack, 'specialDefense', s.special_defense, 'speed', s.speed)
      from public.stats s where s.pokemon_id = p.id
    ),

    'evolutionChain', public.evolution_chain_for(p.id),

    -- Other forms sharing this dex number, each with its own chain: an Alolan form can
    -- evolve differently from the one it shares a number with.
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'name', v.name,
        'variantLabel', v.variant_label,
        'spriteUrl', null,
        'artworkUrl', null,
        'types', coalesce((
          select jsonb_agg(t.name order by pt.slot)
          from public.pokemon_types pt join public.types t on t.id = pt.type_id
          where pt.pokemon_id = v.id
        ), '[]'::jsonb),
        'evolutionChain', public.evolution_chain_for(v.id)
      ) order by v.is_default_variety desc, v.variant_label)
      from public.pokemon v
      where v.national_dex_number = p.national_dex_number and v.id <> p.id
    ), '[]'::jsonb),

    'tcgCards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'number', c.number,
        'setId', c.set_id,
        'setName', c.set_name,
        'series', c.series,
        'rarity', c.rarity,
        'releaseDate', c.release_date,
        'imageSmall', null,
        'imageLarge', null,
        -- One entry per box rather than per copy, matching search_cards: a box holding three
        -- of a card is one line reading three, and entryId names the newest copy, which is
        -- the one a tap removes.
        'inBoxes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'entryId', e.entry_id, 'boxId', e.box_id, 'boxName', e.box_name, 'quantity', e.quantity))
          from (
            select ce.box_id, b.name as box_name, max(ce.id) as entry_id, count(*) as quantity
            from public.collection_entries ce
            join public.collection_boxes b on b.id = ce.box_id
            where ce.card_id = c.id
            group by ce.box_id, b.name
          ) e
        ), '[]'::jsonb),
        'totalOwned', (select count(*) from public.collection_entries ce where ce.card_id = c.id)
      ) order by c.release_date, c.set_name, public.card_number_sort(c.number), c.number)
      from public.tcg_card_pokemon tcp
      join public.tcg_cards c on c.id = tcp.card_id
      where tcp.pokemon_id = p.id
    ), '[]'::jsonb)
  ) end
  from public.pokemon p
  where p.id = p_id;
$$;

revoke execute on function public.evolution_node(integer, text, integer, text, integer[]) from public, anon;
revoke execute on function public.evolution_chain_for(integer) from public, anon;
revoke execute on function public.pokemon_detail(integer) from public, anon;
grant execute on function public.evolution_node(integer, text, integer, text, integer[]) to authenticated, service_role;
grant execute on function public.evolution_chain_for(integer) to authenticated, service_role;
grant execute on function public.pokemon_detail(integer) to authenticated, service_role;
