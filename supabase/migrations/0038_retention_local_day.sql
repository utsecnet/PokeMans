-- Point the retention and the chart at the same clock.
--
-- Both decided what "today" was with current_date, which is UTC, so a day ended at 6pm
-- Mountain. For the chart that meant the last point was labelled tomorrow all evening; for
-- the retention it meant the bands shifted six hours early, which on its own is harmless
-- but puts it out of step with the loader -- and the two disagreeing about where a day ends
-- is how a nightly job starts deleting what the backfill just wrote.


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

  -- Oldest band first. Thinning the twice-weekly band before the weekly one would make the
  -- weekly pass bucket points that are about to disappear anyway.

  -- ---- 31 days and older: one point per week -------------------------------------
  with in_band as (
    select
      card_id, variant_position, captured_on,
      -- date_trunc('week') lands on the Monday of that week, so this is the Monday a point
      -- belongs to. The newest point in the bucket is the price in force going into the
      -- next one.
      date_trunc('week', captured_on)::date as bucket,
      min(captured_on) over (partition by card_id, variant_position) as first_point,
      max(captured_on) over (partition by card_id, variant_position) as last_point
    from public.price_point
    where source_id = p_source_id
      and captured_on <= public.app_today() - 31
  ),
  ranked as (
    select card_id, variant_position, captured_on, first_point, last_point,
           row_number() over (
             partition by card_id, variant_position, bucket
             order by captured_on desc
           ) as rank_in_bucket
    from in_band
  ),
  doomed as (
    select card_id, variant_position, captured_on
    from ranked
    where rank_in_bucket > 1
      and captured_on <> first_point
      and captured_on <> last_point
  ),
  gone as (
    delete from public.price_point pp using doomed d
    where pp.source_id = p_source_id
      and pp.card_id = d.card_id
      and pp.variant_position = d.variant_position
      and pp.captured_on = d.captured_on
      and not p_dry_run
    returning 1
  )
  select count(*) into v_killed
  from (select 1 from gone union all select 1 from doomed where p_dry_run) c;

  v_result := v_result || jsonb_build_object('band', '31+ days', 'keep', 'Mondays', 'removed', v_killed);

  -- ---- 8 to 30 days: one point per half week -------------------------------------
  with in_band as (
    select
      card_id, variant_position, captured_on,
      -- Monday to Wednesday is one bucket, Thursday to Sunday the next, so a Monday and a
      -- Thursday point both survive. isodow runs 1 (Monday) to 7 (Sunday).
      (date_trunc('week', captured_on)::date
        + case when extract(isodow from captured_on) >= 4 then 3 else 0 end) as bucket,
      min(captured_on) over (partition by card_id, variant_position) as first_point,
      max(captured_on) over (partition by card_id, variant_position) as last_point
    from public.price_point
    where source_id = p_source_id
      and captured_on <= public.app_today() - 8
      and captured_on >  public.app_today() - 31
  ),
  ranked as (
    select card_id, variant_position, captured_on, first_point, last_point,
           row_number() over (
             partition by card_id, variant_position, bucket
             order by captured_on desc
           ) as rank_in_bucket
    from in_band
  ),
  doomed as (
    select card_id, variant_position, captured_on
    from ranked
    where rank_in_bucket > 1
      and captured_on <> first_point
      and captured_on <> last_point
  ),
  gone as (
    delete from public.price_point pp using doomed d
    where pp.source_id = p_source_id
      and pp.card_id = d.card_id
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

create or replace function public.card_price_history(p_card_id text, p_days integer default 365)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      greatest(
        coalesce((select min(captured_on) from public.price_point where card_id = p_card_id),
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
  -- Each stored printing, tagged with the upstream product that prices it.
  tagged as (
    select distinct
      pp.card_id,
      pp.variant_position,
      pp.source_id,
      coalesce(pm.external_id::text || '~' || coalesce(pm.sub_type, ''),
               'unmapped~' || pp.variant_position) as price_key
    from public.price_point pp
    left join public.price_map pm
      on pm.card_id = pp.card_id
     and pm.variant_position = pp.variant_position
     and pm.source_id = pp.source_id
    where pp.card_id = p_card_id
      and exists (
        select 1 from public.price_point q
        where q.card_id = pp.card_id
          and q.variant_position = pp.variant_position
          and q.source_id = pp.source_id
          and q.market is not null
      )
  ),
  -- One row per distinct price: the printings it covers, and one of them to read from.
  grouped as (
    select
      price_key,
      source_id,
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
      from public.price_point pp
      where pp.card_id = p_card_id
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
      -- What the figure actually measures. TCGplayer publishes a market price per
      -- condition and this is the Near Mint one, which is why it can sit well above the
      -- cheapest listing on their own product page.
      'basis',     ps.price_basis,
      'printings', (
        select coalesce(jsonb_agg(printing order by printing -> 'variantPositions' -> 0), '[]'::jsonb)
        from (
          select jsonb_build_object(
            -- Kept for callers that key off a single printing; it is the lowest position
            -- in the group.
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

