-- Correct the rows that were stamped tomorrow.
--
-- Runs that happened on the evening of the 7th local time were dated the 8th, because UTC
-- had already turned over. They describe work done today and sat in the future: 32,074
-- observed_on dates and one run-log row, which made the dashboard report "-1 days since
-- the last run".
--
-- Written as a migration rather than run and forgotten, because it is the companion to the
-- change that stopped it happening, and because anyone restoring this database from the
-- migrations alone should get the corrected state.
--
-- Idempotent: it only touches rows dated after today, so re-running it does nothing.

update public.price_latest
   set observed_on = public.app_today()
 where observed_on > public.app_today();

-- The run log has one row per source, job and day. A future-dated row and today's row are
-- the same local day's work, so the later figures win and the stray is dropped.
insert into public.sync_day
  (source_id, job, ran_on, status, started_at, finished_at, series_seen, rows_written, failures, duration_ms, note)
select source_id, job, public.app_today(), status, started_at, finished_at,
       series_seen, rows_written, failures, duration_ms, note
from public.sync_day
where ran_on > public.app_today()
on conflict (source_id, job, ran_on) do update
  set status = excluded.status, finished_at = excluded.finished_at,
      series_seen = excluded.series_seen, rows_written = excluded.rows_written,
      failures = excluded.failures, duration_ms = excluded.duration_ms, note = excluded.note;

delete from public.sync_day where ran_on > public.app_today();

-- A price point dated in the future would be worse: the chart's carry-forward reads the
-- newest point at or before a day, so one would pin every later day to it. None exist, but
-- the same rule applies if one ever does.
delete from public.price_point where captured_on > public.app_today();
