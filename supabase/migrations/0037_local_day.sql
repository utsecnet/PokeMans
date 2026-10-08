-- Decide what day it is in one place, and make it the right day.
--
-- The database runs in UTC, so current_date rolls over at 6pm Mountain time. Prices
-- captured on the evening of the 7th were stamped the 8th, the chart's last point read
-- "8 Oct" on the evening of the 7th, and "priced today" meant "priced since 6pm".
--
-- Nothing was wrong with the data -- captured_on is a plain date and carries no zone -- but
-- every part of the system was answering "what day is it" with UTC's answer rather than
-- the one on the wall.
--
-- So there is now a single function that says what day it is, and everything that needs to
-- know calls it. One place to change if this ever has to serve more than one timezone, and
-- no chance of the Edge Function and the retention job disagreeing about where a day ends,
-- which would have them writing and deleting the same rows.

/**
 * Today, where the collection actually is.
 *
 * `stable` rather than `immutable`: it changes between transactions and Postgres must not
 * fold it into a cached plan or an index expression.
 */
create or replace function public.app_today()
returns date
language sql
stable
set search_path = ''
as $$
  -- The one place the timezone is written down. Mountain time, which is where the
  -- collection is kept; the prices themselves are published on a US schedule, so this also
  -- sits closer to the source's own day than UTC does.
  select (now() at time zone 'America/Denver')::date;
$$;

grant execute on function public.app_today() to authenticated, service_role;

-- ---------------------------------------------------------------- the readers

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
    'historyRows',      (select count(*) from public.price_point),
    'oldestPoint',      (select min(captured_on) from public.price_point),
    'newestPoint',      (select max(captured_on) from public.price_point)
  );
$$;

revoke execute on function public.price_health() from public, anon;
grant execute on function public.price_health() to authenticated, service_role;

create or replace function public.sync_calendar(p_days integer default 365)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with window_days as (
    select d::date as day
    from generate_series(public.app_today() - (least(greatest(p_days, 1), 730) - 1),
                         public.app_today(), '1 day') d
  ),
  jobs as (
    select distinct source_id, job from public.sync_day
    union
    select ps.id, j.job from public.price_source ps cross join (values ('prices'), ('thin')) j(job)
  )
  select coalesce(jsonb_agg(track order by track ->> 'label', track ->> 'job'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'sourceKey', ps.key,
      'label',     ps.label,
      'job',       j.job,
      'days', (
        select jsonb_agg(
          jsonb_build_object(
            'day',    w.day,
            'status', coalesce(sd.status, 'none'),
            'rows',   sd.rows_written,
            'series', sd.series_seen,
            'fails',  sd.failures,
            'ms',     sd.duration_ms,
            'note',   sd.note
          ) order by w.day)
        from window_days w
        left join public.sync_day sd
          on sd.ran_on = w.day and sd.source_id = j.source_id and sd.job = j.job
      )
    ) as track
    from jobs j
    join public.price_source ps on ps.id = j.source_id
  ) tracks;
$$;

revoke execute on function public.sync_calendar(integer) from public, anon;
grant execute on function public.sync_calendar(integer) to authenticated, service_role;

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
    (p_source_id, p_job, public.app_today(), p_status,
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
