-- Put the thinning on the schedule, and move the price capture to match the new source.
--
-- The capture used to be two runs an hour apart because one invocation could price at most
-- 400 cards and the catalogue needed several. It now fetches 220 set files and finishes the
-- whole catalogue in about five seconds, so the second run exists only as a retry: the
-- function records the day it captured and skips a repeat, making the 08:00 run free unless
-- the 07:00 one failed.
--
-- Thinning runs daily rather than weekly. The work is the same either way -- a day becomes
-- eligible the moment it ages past seven -- but a weekly job leaves six of every seven
-- squares blank on the dashboard calendar, and a calendar that is mostly blank teaches the
-- reader to ignore blanks. That is the one thing it must not do.

select cron.unschedule('thin-price-history')
where exists (select 1 from cron.job where jobname = 'thin-price-history');

-- 05:00, two hours before the capture. Thinning yesterday's tail before today's prices
-- arrive keeps the two jobs from contending for the same table, and means the storage
-- figure on the dashboard is the settled one rather than a peak.
select cron.schedule(
  'thin-price-history',
  '0 5 * * *',
  $cron$ select public.invoke_edge_function('thin-price-history'); $cron$
);
