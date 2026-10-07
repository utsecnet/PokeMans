-- Give the write functions room to finish.
--
-- A year of backfill put 2.2 million rows in price_point, and the daily capture started
-- failing with "canceling statement due to statement timeout". Nothing was wrong with the
-- query: 32,000 upserts against a table that size simply take longer than the default
-- allows, and the default is tuned for requests a browser makes, not for a nightly job.
--
-- Raised per function rather than for the whole database. A slow query from a card page
-- should still be cut off quickly -- that limit protects the site from one bad request --
-- and only these three, which run on a schedule and are expected to be slow, get longer.
--
-- 120 seconds sits under the 150 an Edge Function gets, so the statement is cancelled by
-- Postgres with an error worth reading rather than by the runtime killing the whole
-- invocation and leaving no trace of what happened.
alter function public.record_prices(smallint, date, jsonb)
  set statement_timeout = '120s';

alter function public.thin_price_history(smallint, boolean)
  set statement_timeout = '120s';

-- Reads over the whole history grew too: counting 2.2 million rows for the dashboard is a
-- second or two, and price_health does several such counts in one call.
alter function public.price_health()
  set statement_timeout = '60s';

alter function public.set_coverage()
  set statement_timeout = '60s';
