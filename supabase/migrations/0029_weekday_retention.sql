-- Retention on weekdays rather than intervals.
--
--     0-7 days    every day
--     8-30 days   Mondays and Thursdays
--     31+ days    Mondays
--
-- Less than half the rows of the interval policy it replaces, and the saving buys depth:
-- the whole of the upstream mirror, back to February 2024, now costs about 249 MB where a
-- single year under the old rule cost 236 MB.
--
-- Weekdays also make the kept dates predictable. "Every third point" depended on where
-- counting started, so two series could be sampled on different days and the same date could
-- be kept this month and dropped next; a Monday is a Monday regardless of what came before.
--
-- As ever the rule is applied by bucket rather than by deleting the days that do not match.
-- price_point holds a row only where a price moved, so most Mondays have no row at all, and
-- deleting everything that is not a Monday would throw away the only record of a change and
-- leave the chart carrying an older value straight over it. Instead each bucket keeps its
-- newest point -- the price in force when that bucket ended -- which is exactly what the
-- reader's carry-forward needs.
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
      and captured_on <= current_date - 31
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
      and captured_on <= current_date - 8
      and captured_on >  current_date - 31
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
