-- Measure freshness against the last run, not against the calendar.
--
-- price_health reported "priced today" by counting rows whose observed_on equalled
-- current_date. That reads 0% for most of the day, every day: the capture runs at 07:00 UTC
-- and stamps that date, so from the moment UTC rolls over until the next run completes,
-- every row looks like it was missed. The dashboard showed 0% in amber minutes after a
-- capture that had just succeeded for all 28,193 printings.
--
-- A figure that alarms when nothing is wrong is worse than no figure: it trains whoever
-- reads it to ignore the colour, and the colour is the whole point.
--
-- So the question becomes "did the most recent run cover everything it should", which is
-- what an admin actually wants to know and does not move with the clock. How long ago that
-- run was is reported separately, as its own fact, where being a day old is visible without
-- being dressed up as a failure.
create or replace function public.price_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with latest as (
    select max(observed_on) as ran_on from public.price_latest
  )
  select jsonb_build_object(
    'mappedPrintings',  (select count(*) from public.price_map),
    'totalPrintings',   (select count(*) from public.tcg_card_variants),
    'pricedPrintings',  (select count(*) from public.price_latest),
    -- Covered by the most recent run, whenever that was.
    'coveredByLastRun', (select count(*) from public.price_latest pl, latest l
                          where pl.observed_on = l.ran_on),
    'lastRunOn',        (select ran_on from latest),
    'daysSinceLastRun', (select current_date - ran_on from latest),
    -- Still measured against the calendar, because "nobody has looked at this in three days"
    -- is a genuine fault however recently the last run finished.
    'staleOver3Days',   (select count(*) from public.price_latest
                          where observed_on < current_date - 3),
    'historyRows',      (select count(*) from public.price_point),
    'oldestPoint',      (select min(captured_on) from public.price_point),
    'newestPoint',      (select max(captured_on) from public.price_point)
  );
$$;

revoke execute on function public.price_health() from public, anon;
grant execute on function public.price_health() to authenticated, service_role;
