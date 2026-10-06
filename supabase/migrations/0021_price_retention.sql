-- Thinning old price history, without putting holes in the charts.
--
-- The bands, oldest first:
--
--     0-7 days      every day
--     8-30 days     every 2nd day
--     31-365 days   every 3rd day
--     365+ days     every 7th day
--
-- Measured against real data these cut long-run growth from roughly 546 MB a year to about
-- 149 MB, which is the difference between filling the free tier inside a year and not.
--
-- The subtlety is that price_point is already sparse. A row exists only where the price
-- moved, so the rows are not evenly spread and a naive "delete anything not on a third day"
-- would throw away the only record of a change that happened on the wrong date -- the chart
-- would then carry the previous value forward over it and show a flat line where there was
-- a jump. Deleting a row here does not blur history, it rewrites it.
--
-- So the rule is positional, not calendar-based: inside a band, keep every Nth surviving
-- point per series and drop the ones between. The first and last points of every series are
-- always kept, so a series never loses the value that anchors its carry-forward.

/**
 * Applies the retention bands to one source, oldest data first.
 *
 * Returns what it removed per band so the dashboard can show the job doing something
 * rather than just reporting success.
 *
 * security definer because it deletes from a table no session role may touch; execute is
 * granted to the service role alone.
 */
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
      -- (from_age, to_age, keep_every)  ages in days, from_age exclusive upper bound
      (  8,   30, 2),
      ( 31,  365, 3),
      (366, 99999, 7)
    ) as b(from_age, to_age, keep_every)
    -- Oldest band first: thinning the 3-day band before the 7-day one would make the 7-day
    -- pass count points that are about to disappear anyway.
    order by b.from_age desc
  loop
    with in_band as (
      select
        card_id, variant_position, captured_on,
        row_number() over (
          partition by card_id, variant_position
          order by captured_on
        ) as seq,
        count(*) over (partition by card_id, variant_position) as total
      from public.price_point
      where source_id = p_source_id
        and captured_on <= current_date - v_band.from_age
        and captured_on >  current_date - v_band.to_age
    ),
    doomed as (
      select card_id, variant_position, captured_on
      from in_band
      -- Keep every Nth point, and always the first and last of the series so the line still
      -- starts and ends where it did.
      where seq <> 1
        and seq <> total
        and (seq - 1) % v_band.keep_every <> 0
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
    select count(*) into v_killed from gone;

    v_result := v_result || jsonb_build_object(
      'fromAge', v_band.from_age, 'toAge', v_band.to_age,
      'keepEvery', v_band.keep_every, 'removed', v_killed);
  end loop;

  select count(*) into v_after from public.price_point where source_id = p_source_id;

  return jsonb_build_object(
    'dryRun', p_dry_run,
    'before', v_before,
    'after',  v_after,
    'removed', v_before - v_after,
    'bands',  v_result
  );
end;
$$;

revoke execute on function public.thin_price_history(smallint, boolean) from public, anon, authenticated;
grant execute on function public.thin_price_history(smallint, boolean) to service_role;

/**
 * Records the outcome of a scheduled job for the dashboard calendar.
 *
 * Separate from the jobs themselves so an Edge Function reports its own result in one call
 * rather than composing an upsert, and so the status vocabulary lives in one place.
 */
create or replace function public.record_sync_day(
  p_source_id smallint,
  p_job       text,
  p_status    text,
  p_series    integer default 0,
  p_rows      integer default 0,
  p_failures  integer default 0,
  p_ms        integer default null,
  p_note      text    default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.sync_day
    (source_id, job, ran_on, status, started_at, finished_at, series_seen, rows_written, failures, duration_ms, note)
  values
    (p_source_id, p_job, current_date, p_status,
     now() - coalesce(p_ms, 0) * interval '1 millisecond', now(),
     p_series, p_rows, p_failures, p_ms, p_note)
  on conflict (source_id, job, ran_on) do update
    set status = excluded.status, finished_at = excluded.finished_at,
        series_seen = excluded.series_seen, rows_written = excluded.rows_written,
        failures = excluded.failures, duration_ms = excluded.duration_ms, note = excluded.note;
$$;

revoke execute on function public.record_sync_day(smallint, text, text, integer, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.record_sync_day(smallint, text, text, integer, integer, integer, integer, text)
  to service_role;
