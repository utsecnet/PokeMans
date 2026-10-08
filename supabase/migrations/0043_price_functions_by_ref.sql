-- Every price function, rewritten for the integer card reference.
--
-- All of these take and return the public card id. The integer is a storage detail and does
-- not leak into the app: a caller passes "base1-4" exactly as before, and the translation
-- happens once per call against an index on tcg_cards (id) include (ref).
--
-- They are all in one migration because they all read the same three tables. Splitting them
-- would leave the database in a state where half the functions reference a column the other
-- half has dropped, and the gap between two migrations is exactly when a scheduled job runs.

-- ---------------------------------------------------------------- one price, now

create or replace function public.entry_price(p_card_id text, p_variant integer)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select pl.market
  from public.price_latest pl
  join public.tcg_cards c on c.ref = pl.card_ref
  where p_variant is not null
    and c.id = p_card_id
    and pl.variant_position = p_variant::smallint
    and pl.market is not null
  limit 1;
$$;

grant execute on function public.entry_price(text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------- first recorded

create or replace function public.card_first_priced(p_card_id text)
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select min(pp.captured_on)
  from public.price_point pp
  join public.tcg_cards c on c.ref = pp.card_ref
  where c.id = p_card_id;
$$;

grant execute on function public.card_first_priced(text) to authenticated, service_role;

-- ---------------------------------------------------------------- the chart

create or replace function public.card_price_history(p_card_id text, p_days integer default 365)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with card as (
    select ref from public.tcg_cards where id = p_card_id
  ),
  bounds as (
    select
      greatest(
        coalesce((select min(captured_on) from public.price_point, card
                   where price_point.card_ref = card.ref),
                 public.app_today()),
        public.app_today() - (least(greatest(p_days, 1), 1825) || ' days')::interval
      )::date as from_day,
      public.app_today() as to_day
  ),
  stride as (
    select greatest(1, ceil(((to_day - from_day + 1)::numeric) / 400))::int as step,
           from_day, to_day
    from bounds
  ),
  days as (
    select d::date as day from stride s, generate_series(s.from_day, s.to_day, '1 day') d
  ),
  tagged as (
    select distinct
      pp.card_ref,
      pp.variant_position,
      pp.source_id,
      coalesce(pm.external_id::text || '~' || coalesce(pm.sub_type, ''),
               'unmapped~' || pp.variant_position) as price_key
    from public.price_point pp, card
    left join public.price_map pm
      on pm.card_ref = pp.card_ref
     and pm.variant_position = pp.variant_position
     and pm.source_id = pp.source_id
    where pp.card_ref = card.ref
      and exists (
        select 1 from public.price_point q
        where q.card_ref = pp.card_ref
          and q.variant_position = pp.variant_position
          and q.source_id = pp.source_id
          and q.market is not null
      )
  ),
  grouped as (
    select price_key, source_id,
           min(variant_position) as read_from,
           array_agg(variant_position order by variant_position) as positions
    from tagged
    group by price_key, source_id
  ),
  dense as (
    select g.price_key, g.source_id, g.positions, d.day, last_value.market, last_value.low
    from grouped g
    cross join days d
    left join lateral (
      select pp.market, pp.low
      from public.price_point pp, card
      where pp.card_ref = card.ref
        and pp.variant_position = g.read_from
        and pp.source_id = g.source_id
        and pp.captured_on <= d.day
      order by pp.captured_on desc
      limit 1
    ) last_value on true
    where last_value.market is not null
  ),
  thinned as (
    select d.*
    from (
      select dense.*,
             row_number() over (partition by price_key, source_id order by day) as seq,
             count(*) over (partition by price_key, source_id) as total
      from dense
    ) d, stride st
    where (d.seq - 1) % st.step = 0 or d.seq = 1 or d.seq = d.total
  )
  select coalesce(jsonb_agg(chart order by chart ->> 'label'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'sourceKey', ps.key,
      'label',     ps.label,
      'currency',  ps.currency,
      'basis',     ps.price_basis,
      'printings', (
        select coalesce(jsonb_agg(printing order by printing -> 'variantPositions' -> 0), '[]'::jsonb)
        from (
          select jsonb_build_object(
            'variantPosition', (v.positions)[1],
            'variantPositions', to_jsonb(v.positions),
            'points', (
              select coalesce(jsonb_agg(
                jsonb_build_object('day', tt.day, 'market', tt.market, 'low', tt.low)
                order by tt.day), '[]'::jsonb)
              from thinned tt
              where tt.price_key = v.price_key and tt.source_id = v.source_id
            )
          ) as printing
          from (select distinct price_key, source_id, positions from thinned) v
          where v.source_id = ps.id
        ) printings
      )
    ) as chart
    from public.price_source ps
    where exists (select 1 from thinned t2 where t2.source_id = ps.id)
  ) charts;
$$;

grant execute on function public.card_price_history(text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------- health

/**
 * Whether the price data is sound.
 *
 * The row count is an estimate from the planner's statistics rather than a count(*). An
 * exact count of 2.8 million rows is a five second sequential scan, and this figure sits on
 * a dashboard beside two others that were doing the same -- the panel took 27 seconds to
 * draw. The estimate is within a fraction of a percent, refreshed by every autovacuum, and
 * nothing here is a figure anyone counts on to the row.
 *
 * The oldest and newest dates now use the (source_id, captured_on) index, so they are an
 * index probe each rather than two more scans.
 */
create or replace function public.price_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
set statement_timeout = '60s'
as $$
  with latest as (
    select max(observed_on) as ran_on from public.price_latest
  )
  select jsonb_build_object(
    'mappedPrintings',  (select count(*) from public.price_map),
    'totalPrintings',   (select count(*) from public.tcg_card_variants),
    'pricedPrintings',  (select count(*) from public.price_latest),
    'coveredByLastRun', (select count(*) from public.price_latest pl, latest l
                          where pl.observed_on = l.ran_on),
    'lastRunOn',        (select ran_on from latest),
    'daysSinceLastRun', (select public.app_today() - ran_on from latest),
    'staleOver3Days',   (select count(*) from public.price_latest
                          where observed_on < public.app_today() - 3),
    'historyRows',      (select greatest(reltuples, 0)::bigint
                          from pg_class where oid = 'public.price_point'::regclass),
    'historyRowsExact', false,
    'oldestPoint',      (select min(captured_on) from public.price_point),
    'newestPoint',      (select max(captured_on) from public.price_point)
  );
$$;

revoke execute on function public.price_health() from public, anon;
grant execute on function public.price_health() to authenticated, service_role;

-- ---------------------------------------------------------------- coverage per set

create or replace function public.set_coverage()
returns jsonb
language sql
stable
security invoker
set search_path = ''
set statement_timeout = '60s'
as $$
  with per_set as (
    select
      s.id, s.name, s.release_date,
      count(distinct tc.id)      as cards,
      count(tcv.position)        as printings,
      count(pm.card_ref)         as mapped,
      count(pl.card_ref)         as priced,
      max(pl.observed_on)        as last_seen
    from public.tcg_sets s
    left join public.tcg_cards tc on tc.set_id = s.id
    left join public.tcg_card_variants tcv on tcv.card_id = tc.id
    left join public.price_map pm
      on pm.card_ref = tc.ref and pm.variant_position = tcv.position
    left join public.price_latest pl
      on pl.card_ref = tc.ref and pl.variant_position = tcv.position
    group by s.id, s.name, s.release_date
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'setId', id, 'name', name, 'releaseDate', release_date,
      'cards', cards, 'printings', printings, 'mapped', mapped, 'priced', priced,
      'pct', case when printings = 0 then null
                  else round(100.0 * priced / printings, 1) end,
      'lastSeen', last_seen
    )
    order by
      case when printings = 0 then 1 else 0 end,
      case when printings = 0 then null else round(100.0 * priced / printings, 1) end,
      name
  ), '[]'::jsonb)
  from per_set;
$$;

revoke execute on function public.set_coverage() from public, anon;
grant execute on function public.set_coverage() to authenticated, service_role;

-- ---------------------------------------------------------------- recording

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
  create temporary table _incoming on commit drop as
  select
    (e ->> 'externalId')::bigint         as external_id,
    nullif(e ->> 'subType', '')          as sub_type,
    (e ->> 'market')::numeric(12,2)      as market,
    (e ->> 'low')::numeric(12,2)         as low
  from jsonb_array_elements(p_payload) e;

  select count(*) into v_incoming from _incoming;

  -- Asked of _incoming, not inferred from the size of the join: one product can price
  -- several printings, so the join fans out and the difference is not what went unmatched.
  select count(*) into v_unmapped
  from _incoming i
  where not exists (
    select 1 from public.price_map pm
    where pm.source_id = p_source_id
      and pm.external_id = i.external_id
      and pm.sub_type is not distinct from i.sub_type
  );

  create temporary table _resolved on commit drop as
  select pm.card_ref, pm.variant_position, i.market, i.low
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
      on pl.card_ref = r.card_ref
     and pl.variant_position = r.variant_position
     and pl.source_id = p_source_id
    where pl.card_ref is null
       or pl.market is distinct from r.market
       or pl.low    is distinct from r.low
  ),
  written as (
    insert into public.price_point (card_ref, variant_position, source_id, captured_on, market, low)
    select card_ref, variant_position, p_source_id, p_captured_on, market, low from moved
    on conflict (card_ref, variant_position, source_id, captured_on)
      do update set market = excluded.market, low = excluded.low
    returning 1
  )
  select count(*) into v_changed from written;

  insert into public.price_latest as pl
    (card_ref, variant_position, source_id, captured_on, observed_on, market, low)
  select card_ref, variant_position, p_source_id, p_captured_on, p_captured_on, market, low
  from _resolved
  on conflict (card_ref, variant_position, source_id) do update
    set observed_on = excluded.observed_on,
        captured_on = case
          when pl.market is distinct from excluded.market
            or pl.low    is distinct from excluded.low
          then excluded.captured_on else pl.captured_on end,
        market = excluded.market,
        low    = excluded.low;

  v_unchanged := v_resolved - v_changed;

  return jsonb_build_object(
    'incoming',  v_incoming,
    'resolved',  v_resolved,
    'unmapped',  v_unmapped,
    'changed',   v_changed,
    'unchanged', greatest(v_unchanged, 0)
  );
end;
$$;

revoke execute on function public.record_prices(smallint, date, jsonb) from public, anon, authenticated;
grant execute on function public.record_prices(smallint, date, jsonb) to service_role;

-- ---------------------------------------------------------------- thinning

create or replace function public.thin_price_history(
  p_source_id smallint default 1,
  p_dry_run   boolean  default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_killed integer;
  v_before bigint;
  v_after  bigint;
begin
  select count(*) into v_before from public.price_point where source_id = p_source_id;

  -- 31 days and older: one point per week, the newest in each.
  with in_band as (
    select
      card_ref, variant_position, captured_on,
      date_trunc('week', captured_on)::date as bucket,
      min(captured_on) over (partition by card_ref, variant_position) as first_point,
      max(captured_on) over (partition by card_ref, variant_position) as last_point
    from public.price_point
    where source_id = p_source_id
      and captured_on <= public.app_today() - 31
  ),
  ranked as (
    select card_ref, variant_position, captured_on, first_point, last_point,
           row_number() over (
             partition by card_ref, variant_position, bucket
             order by captured_on desc
           ) as rank_in_bucket
    from in_band
  ),
  doomed as (
    select card_ref, variant_position, captured_on
    from ranked
    where rank_in_bucket > 1
      and captured_on <> first_point
      and captured_on <> last_point
  ),
  gone as (
    delete from public.price_point pp using doomed d
    where pp.source_id = p_source_id
      and pp.card_ref = d.card_ref
      and pp.variant_position = d.variant_position
      and pp.captured_on = d.captured_on
      and not p_dry_run
    returning 1
  )
  select count(*) into v_killed
  from (select 1 from gone union all select 1 from doomed where p_dry_run) c;

  v_result := v_result || jsonb_build_object('band', '31+ days', 'keep', 'Mondays', 'removed', v_killed);

  -- 8 to 30 days: one point per half week, so a Monday and a Thursday both survive.
  with in_band as (
    select
      card_ref, variant_position, captured_on,
      (date_trunc('week', captured_on)::date
        + case when extract(isodow from captured_on) >= 4 then 3 else 0 end) as bucket,
      min(captured_on) over (partition by card_ref, variant_position) as first_point,
      max(captured_on) over (partition by card_ref, variant_position) as last_point
    from public.price_point
    where source_id = p_source_id
      and captured_on <= public.app_today() - 8
      and captured_on >  public.app_today() - 31
  ),
  ranked as (
    select card_ref, variant_position, captured_on, first_point, last_point,
           row_number() over (
             partition by card_ref, variant_position, bucket
             order by captured_on desc
           ) as rank_in_bucket
    from in_band
  ),
  doomed as (
    select card_ref, variant_position, captured_on
    from ranked
    where rank_in_bucket > 1
      and captured_on <> first_point
      and captured_on <> last_point
  ),
  gone as (
    delete from public.price_point pp using doomed d
    where pp.source_id = p_source_id
      and pp.card_ref = d.card_ref
      and pp.variant_position = d.variant_position
      and pp.captured_on = d.captured_on
      and not p_dry_run
    returning 1
  )
  select count(*) into v_killed
  from (select 1 from gone union all select 1 from doomed where p_dry_run) c;

  v_result := v_result || jsonb_build_object('band', '8-30 days', 'keep', 'Mondays and Thursdays', 'removed', v_killed);

  select count(*) into v_after from public.price_point where source_id = p_source_id;

  return jsonb_build_object(
    'dryRun', p_dry_run,
    'before', v_before,
    'after',  case when p_dry_run then v_before else v_after end,
    'removed', case when p_dry_run
      then (select coalesce(sum((b ->> 'removed')::bigint), 0) from jsonb_array_elements(v_result) b)
      else v_before - v_after end,
    'bands',  v_result
  );
end;
$$;

revoke execute on function public.thin_price_history(smallint, boolean) from public, anon, authenticated;
grant execute on function public.thin_price_history(smallint, boolean) to service_role;
