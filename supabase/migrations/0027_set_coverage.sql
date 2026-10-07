-- Coverage per set, worst first.
--
-- This exists because every other measure said the data was fine while three whole sets had
-- no prices at all. Sun & Moon had none of 173 cards, Scarlet & Violet 50 of 258, Diamond &
-- Pearl 4 of 130 -- and the headline coverage figure read 85%, the run log was green, and
-- the sync reported twenty-eight thousand rows written with zero failures. All of those were
-- true. None of them could see it.
--
-- The reason an aggregate cannot: a set matched to the wrong upstream group is still
-- matched. Its cards have mappings, those mappings return prices, and the totals move in the
-- right direction. What goes missing is a whole set at a time, which only shows up when the
-- figure is cut by set.
--
-- Sorted ascending deliberately. A list of two hundred sets sorted by name hides a zero in
-- the middle; sorted by coverage, the broken ones are the first thing on screen.
create or replace function public.set_coverage()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with per_set as (
    select
      s.id,
      s.name,
      s.release_date,
      count(distinct tc.id)                                     as cards,
      count(tcv.position)                                       as printings,
      count(pm.card_id)                                         as mapped,
      count(pl.card_id)                                         as priced,
      max(pl.observed_on)                                       as last_seen
    from public.tcg_sets s
    left join public.tcg_cards tc
      on tc.set_id = s.id
    left join public.tcg_card_variants tcv
      on tcv.card_id = tc.id
    left join public.price_map pm
      on pm.card_id = tcv.card_id and pm.variant_position = tcv.position
    left join public.price_latest pl
      on pl.card_id = tcv.card_id and pl.variant_position = tcv.position
    group by s.id, s.name, s.release_date
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'setId',       id,
      'name',        name,
      'releaseDate', release_date,
      'cards',       cards,
      'printings',   printings,
      'mapped',      mapped,
      'priced',      priced,
      -- A set with no printings at all is not 0% covered, it is not a question. Reporting it
      -- as zero would park empty sets permanently at the top of a list meant for faults.
      'pct', case when printings = 0 then null
                  else round(100.0 * priced / printings, 1) end,
      'lastSeen',    last_seen
    )
    order by
      case when printings = 0 then 1 else 0 end,          -- empty sets last
      case when printings = 0 then null
           else round(100.0 * priced / printings, 1) end, -- worst coverage first
      name
  ), '[]'::jsonb)
  from per_set;
$$;

revoke execute on function public.set_coverage() from public, anon;
grant execute on function public.set_coverage() to authenticated, service_role;
