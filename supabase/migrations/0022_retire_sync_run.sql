-- The last of the old price machinery.
--
-- sync_run recorded one row per invocation of the previous capture, which was the right
-- shape when a run priced a few hundred cards and several runs a day were normal. The job
-- it logged no longer exists: a run now covers the whole catalogue in one go, and what an
-- admin needs to see is a year of days with a square each, which is sync_day.
--
-- Two tables describing the same jobs is how a dashboard ends up reading the one nothing
-- writes to any more and showing a year of silence that is not real.
drop table if exists public.sync_run;

-- sync_log predates all of this and was never written to by anything that still runs.
drop table if exists public.sync_log;
