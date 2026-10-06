-- Writing prices, and the two dashboard reads that watch it.

/**
 * Takes a day's prices from one source and records only what moved.
 *
 * The caller hands over everything it fetched; this decides what is worth keeping. A series
 * whose market and low both match what we already hold gets its observed_on bumped and
 * nothing else -- no history row, no new bytes. Measured on real data, that discards 77% of
 * what arrives each day, which is the difference between this fitting in the free tier and
 * not.
 *
 * `is distinct from` rather than `<>` throughout, because a price going to or from null is
 * a change and `=` would call it unknown and quietly skip it.
 *
 * Unmapped products are counted, not inserted and not an error. tcgcsv publishes the whole
 * Pokemon category -- sealed boxes, Japanese printings, cards we do not carry -- and most of
 * what arrives has no place in this catalogue. Counting them is how the dashboard can tell
 * "we only match 60% of what they send" from "the sync failed".
 *
 * security definer because it writes tables no session role may write, with search_path
 * pinned so a planted schema cannot redirect those writes. Execute is granted to the
 * service role alone: this is the Edge Function's door and no browser's.
 */
create or replace function public.record_prices(
  p_source_id   smallint,
  p_captured_on date,
  p_payload     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed   integer := 0;
  v_unchanged integer := 0;
  v_unmapped  integer := 0;
  v_incoming  integer := 0;
begin
  create temporary table _incoming on commit drop as
  select
    (e ->> 'externalId')::bigint         as external_id,
    nullif(e ->> 'subType', '')          as sub_type,
    (e ->> 'market')::numeric(12,2)      as market,
    (e ->> 'low')::numeric(12,2)         as low
  from jsonb_array_elements(p_payload) e;

  select count(*) into v_incoming from _incoming;

  -- Resolve to our own cards. An inner join is what drops the sealed products and foreign
  -- printings we do not carry; the count of what fell out is reported below.
  create temporary table _resolved on commit drop as
  select pm.card_id, pm.variant_position, i.market, i.low
  from _incoming i
  join public.price_map pm
    on pm.source_id = p_source_id
   and pm.external_id = i.external_id
   and pm.sub_type is not distinct from i.sub_type;

  select v_incoming - count(*) into v_unmapped from _resolved;

  -- A history row only where the value actually differs from the one in force.
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
    -- A second run on the same day replaces that day's point rather than failing. Re-running
    -- a sync should be safe and boring.
    on conflict (card_id, variant_position, source_id, captured_on)
      do update set market = excluded.market, low = excluded.low
    returning 1
  )
  select count(*) into v_changed from written;

  -- Everything seen today has its observed_on moved forward, whether or not it moved. That
  -- is what separates "this price is steady" from "we have stopped seeing this card".
  insert into public.price_latest as pl
    (card_id, variant_position, source_id, captured_on, observed_on, market, low)
  select card_id, variant_position, p_source_id, p_captured_on, p_captured_on, market, low
  from _resolved
  on conflict (card_id, variant_position, source_id) do update
    set observed_on = excluded.observed_on,
        -- captured_on only advances when the value itself did, so it keeps meaning "since
        -- when has it been this price".
        captured_on = case
          when pl.market is distinct from excluded.market
            or pl.low    is distinct from excluded.low
          then excluded.captured_on else pl.captured_on end,
        market = excluded.market,
        low    = excluded.low;

  select count(*) - v_changed into v_unchanged from _resolved;

  return jsonb_build_object(
    'incoming',  v_incoming,
    'resolved',  v_incoming - v_unmapped,
    'unmapped',  v_unmapped,
    'changed',   v_changed,
    'unchanged', greatest(v_unchanged, 0)
  );
end;
$$;

revoke execute on function public.record_prices(smallint, date, jsonb) from public, anon, authenticated;
grant execute on function public.record_prices(smallint, date, jsonb) to service_role;

-- ---------------------------------------------------------------- the calendar

/**
 * A year of daily run outcomes per source and job, for the dashboard's grid of squares.
 *
 * Every day in the window is returned, including days nothing ran. A missing row becomes
 * status 'none' rather than being left out, because a silent gap in a calendar reads as
 * "fine" and a day the job never fired is the single most important thing this is meant to
 * show. Colour it grey, not green.
 */
create or replace function public.sync_calendar(p_days integer default 365)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with window_days as (
    select d::date as day
    from generate_series(current_date - (least(greatest(p_days, 1), 730) - 1), current_date, '1 day') d
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

-- ---------------------------------------------------------------- the meter

/**
 * How much of the free tier the database is using, and what is using it.
 *
 * The 500 MB is a hard stop, not a bill: past it, writes fail and the price sync simply
 * stops recording. That is worth seeing coming, so this reports the total against the limit
 * and the ten largest tables behind it.
 *
 * The limit is stated here rather than read from anywhere, because nothing in Postgres knows
 * what plan the project is on. If the plan changes, this number is the thing to change.
 */
create or replace function public.database_usage()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with limits as (select (500 * 1024 * 1024)::bigint as byte_limit),
  total as (select pg_database_size(current_database()) as bytes),
  biggest as (
    select c.relname as table_name, pg_total_relation_size(c.oid) as bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by pg_total_relation_size(c.oid) desc
    limit 10
  )
  select jsonb_build_object(
    'bytes',      t.bytes,
    'byteLimit',  l.byte_limit,
    'pctUsed',    round(100.0 * t.bytes / l.byte_limit, 1),
    'pretty',     pg_size_pretty(t.bytes),
    'limitPretty', pg_size_pretty(l.byte_limit),
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', b.table_name, 'bytes', b.bytes, 'pretty', pg_size_pretty(b.bytes)
      ) order by b.bytes desc), '[]'::jsonb)
      from biggest b
    )
  )
  from total t, limits l;
$$;

revoke execute on function public.database_usage() from public, anon;
grant execute on function public.database_usage() to authenticated, service_role;
