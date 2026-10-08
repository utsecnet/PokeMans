-- Count unmapped products as products.
--
-- record_prices reported "not in our catalogue" by subtracting the number of resolved rows
-- from the number of incoming rows, which compares two different things. Incoming is one
-- row per upstream product; resolved is one row per *our* printing, and one product can
-- serve several -- 32,106 printings come from 29,091 products, so 3,015 resolved rows have
-- no incoming row of their own.
--
-- The figure was therefore short by about 3,000 every run, and the admin panel has been
-- quietly understating how much of the source we do not carry by roughly a fifth. With
-- more duplicates it could in principle have gone negative.
--
-- It now counts the incoming rows that found no mapping, which is the question being asked.
create or replace function public.record_prices(
  p_source_id   smallint,
  p_captured_on date,
  p_payload     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  v_changed   integer := 0;
  v_unchanged integer := 0;
  v_unmapped  integer := 0;
  v_incoming  integer := 0;
  v_resolved  integer := 0;
begin
  -- Temporary tables rather than CTEs, deliberately: _incoming is read three times --
  -- counted, probed for unmapped rows, then joined -- and a CTE would be re-evaluated or
  -- would have to be materialised by hand. They cost a little catalogue churn per call and
  -- the sync makes eight calls a day, which is not worth optimising away.
  create temporary table _incoming on commit drop as
  select
    (e ->> 'externalId')::bigint         as external_id,
    nullif(e ->> 'subType', '')          as sub_type,
    (e ->> 'market')::numeric(12,2)      as market,
    (e ->> 'low')::numeric(12,2)         as low
  from jsonb_array_elements(p_payload) e;

  select count(*) into v_incoming from _incoming;

  -- How many incoming products matched nothing. Asked of _incoming, not inferred from the
  -- size of the join, because the join fans out where one product prices several printings.
  select count(*) into v_unmapped
  from _incoming i
  where not exists (
    select 1 from public.price_map pm
    where pm.source_id = p_source_id
      and pm.external_id = i.external_id
      and pm.sub_type is not distinct from i.sub_type
  );

  create temporary table _resolved on commit drop as
  select pm.card_id, pm.variant_position, i.market, i.low
  from _incoming i
  join public.price_map pm
    on pm.source_id = p_source_id
   and pm.external_id = i.external_id
   and pm.sub_type is not distinct from i.sub_type;

  select count(*) into v_resolved from _resolved;

  with moved as (
    select r.*
    from _resolved r
    left join public.price_latest pl
      on pl.card_id = r.card_id
     and pl.variant_position = r.variant_position
     and pl.source_id = p_source_id
    where pl.card_id is null
       or pl.market is distinct from r.market
       or pl.low    is distinct from r.low
  ),
  written as (
    insert into public.price_point (card_id, variant_position, source_id, captured_on, market, low)
    select card_id, variant_position, p_source_id, p_captured_on, market, low from moved
    on conflict (card_id, variant_position, source_id, captured_on)
      do update set market = excluded.market, low = excluded.low
    returning 1
  )
  select count(*) into v_changed from written;

  insert into public.price_latest as pl
    (card_id, variant_position, source_id, captured_on, observed_on, market, low)
  select card_id, variant_position, p_source_id, p_captured_on, p_captured_on, market, low
  from _resolved
  on conflict (card_id, variant_position, source_id) do update
    set observed_on = excluded.observed_on,
        captured_on = case
          when pl.market is distinct from excluded.market
            or pl.low    is distinct from excluded.low
          then excluded.captured_on else pl.captured_on end,
        market = excluded.market,
        low    = excluded.low;

  v_unchanged := v_resolved - v_changed;

  return jsonb_build_object(
    -- Products the source published.
    'incoming',  v_incoming,
    -- Printings of ours they priced. Larger than incoming minus unmapped, because one
    -- product can price several printings; reported plainly rather than derived.
    'resolved',  v_resolved,
    'unmapped',  v_unmapped,
    'changed',   v_changed,
    'unchanged', greatest(v_unchanged, 0)
  );
end;
$$;

revoke execute on function public.record_prices(smallint, date, jsonb) from public, anon, authenticated;
grant execute on function public.record_prices(smallint, date, jsonb) to service_role;
