-- A fourth retention band: one point a month beyond the first year.
--
-- Everything past 31 days was kept weekly, for ever, and 56% of the history is now older
-- than a year -- 1.6 million of 2.86 million rows. Measured against the days actually
-- stored, keeping one point per calendar month beyond the first year removes 1,225,791 rows
-- and about 123 MB once the primary key and the date index are counted.
--
-- The one-off saving is not the point. Weekly for ever adds roughly 101 MB a year, which
-- against a hard 500 MB ceiling is about eighteen months of headroom from here. Monthly past
-- a year adds about 23 MB, which is a decade.
--
--     0-7 days     every day
--     8-30 days    Mondays and Thursdays
--     31-365 days  Mondays
--     366+ days    one a month
--
-- What a reader loses is a single week's movement from more than a year ago. The chart
-- carries values forward between sampled points, so the shape of a long line barely changes;
-- what goes is the ability to see a spike that came and went inside one week, two years back.
--
-- The newest point in each bucket, never a calendar date chosen in advance, because a
-- printing whose price never moves has no row on most days and picking dates would delete
-- the only row it has. First and last of a series are always kept, so a line never loses its
-- ends and a card with two points in three years keeps both.

create or replace function public.thin_price_history(
  p_source_id smallint default 1,
  p_dry_run   boolean  default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '600s'
as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_killed integer;
  v_before bigint;
  v_after  bigint;
begin
  select count(*) into v_before from public.price_point where source_id = p_source_id;

  -- Over a year old: one point per calendar month.
  with in_band as (
    select
      card_ref, variant_position, captured_on,
      date_trunc('month', captured_on)::date as bucket,
      min(captured_on) over (partition by card_ref, variant_position) as first_point,
      max(captured_on) over (partition by card_ref, variant_position) as last_point
    from public.price_point
    where source_id = p_source_id
      and captured_on <= public.app_today() - 366
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

  v_result := v_result || jsonb_build_object('band', '366+ days', 'keep', 'one a month', 'removed', v_killed);

  -- 31 days to a year: one point per week.
  with in_band as (
    select
      card_ref, variant_position, captured_on,
      date_trunc('week', captured_on)::date as bucket,
      min(captured_on) over (partition by card_ref, variant_position) as first_point,
      max(captured_on) over (partition by card_ref, variant_position) as last_point
    from public.price_point
    where source_id = p_source_id
      and captured_on <= public.app_today() - 31
      and captured_on >  public.app_today() - 366
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

  v_result := v_result || jsonb_build_object('band', '31-365 days', 'keep', 'Mondays', 'removed', v_killed);

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

-- ---------------------------------------------------------------- indexes nothing reads

-- Never used once. record_prices resolves a day's prices by building a temporary table and
-- letting the planner join it against 32,265 rows, which it does by hash every time; the
-- index sat there being maintained on every write and read by nothing.
drop index if exists public.price_map_external_idx;

-- One scan in the life of the database. Card search goes through search_cards, which does
-- not use the operator class a trigram index answers, so the planner has never chosen it.
drop index if exists public.tcg_cards_name_trgm_idx;
