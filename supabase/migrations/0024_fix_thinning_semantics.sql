-- Thin by the calendar, not by position in the list.
--
-- The first version kept every Nth *stored point* per series. That is not the policy. The
-- policy is a calendar one -- a point every second day, then every third -- and because the
-- table is sparse the two readings diverge badly: a series with points only on the days it
-- moved has those points scattered, so "every third point" removes two thirds of them
-- wherever they fall. Run against ninety days of backfill it cut 472,611 rows to 244,920,
-- compressing years of resolution out of history that was already sampled correctly.
--
-- The fix is to bucket by date and keep one point per bucket.
--
-- Which point matters. The *newest* in each bucket is kept, because that is the value in
-- force when the bucket ends, and the reader carries values forward: keeping the oldest
-- would hold a stale figure across the bucket and then jump, which is precisely the false
-- flat line this is supposed to avoid. The first and last points of each series are always
-- kept, so the line still starts and ends where the data does.
--
-- Buckets are measured in whole days from today, so a point's bucket does not shift as the
-- clock moves -- only which band it falls in does, and that is the intent.

create or replace function public.thin_price_history(
  p_source_id smallint default 1,
  p_dry_run   boolean  default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_band   record;
  v_killed integer;
  v_before bigint;
  v_after  bigint;
begin
  select count(*) into v_before from public.price_point where source_id = p_source_id;

  for v_band in
    select * from (values
      (  8,   30, 2),
      ( 31,  365, 3),
      (366, 99999, 7)
    ) as b(from_age, to_age, keep_every)
    order by b.from_age desc
  loop
    with in_band as (
      select
        card_id, variant_position, captured_on,
        -- Whole days old, so a point belongs to the same bucket today and tomorrow.
        (current_date - captured_on) / v_band.keep_every as bucket,
        min(captured_on) over (partition by card_id, variant_position) as first_point,
        max(captured_on) over (partition by card_id, variant_position) as last_point
      from public.price_point
      where source_id = p_source_id
        and captured_on <= current_date - v_band.from_age
        and captured_on >  current_date - v_band.to_age
    ),
    ranked as (
      select
        card_id, variant_position, captured_on, first_point, last_point,
        -- Newest first within the bucket: rank 1 is the value in force when it ends.
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
      delete from public.price_point pp
      using doomed d
      where pp.source_id = p_source_id
        and pp.card_id = d.card_id
        and pp.variant_position = d.variant_position
        and pp.captured_on = d.captured_on
        and not p_dry_run
      returning 1
    )
    select count(*) into v_killed
    from (select 1 from gone union all select 1 from doomed where p_dry_run) counted;

    v_result := v_result || jsonb_build_object(
      'fromAge', v_band.from_age, 'toAge', v_band.to_age,
      'keepEvery', v_band.keep_every, 'removed', v_killed);
  end loop;

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
