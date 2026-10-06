-- Scheduled work: the daily price capture, and the anonymous-account sweep.
--
-- Prices are the reason this exists. A price is a value for a day, and a day missed is
-- missed permanently -- there is no endpoint that answers "what did this cost last
-- Tuesday". Everything else here could be run by hand after the fact; this cannot.
--
-- pg_cron runs the schedule, pg_net makes the outbound call. Both were enabled alongside
-- this migration.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------- the key

-- The Edge Functions admit a scheduled caller by service key, so the schedule has to
-- present one. It is kept in Vault, encrypted at rest, and referenced below by name only:
-- the cron entries and this file never contain the key itself, which is why this migration
-- is safe to hold in git.
--
-- The secret is added once, by hand, in Dashboard -> Integrations -> Vault, named exactly:
--
--     service_role_key
--
-- Nothing here creates it. A migration that carried the key would put it in version
-- control and in every clone of this repository, which is the thing Vault exists to stop.

-- ---------------------------------------------------------------- the caller

/**
 * Posts to one of this project's Edge Functions as the service role.
 *
 * `security definer` because reading vault.decrypted_secrets is privileged, and the whole
 * point is that the caller does not hold the key. That makes this function itself a way to
 * spend the service role, so execute is revoked from everyone: cron runs it as the table
 * owner and no session role can reach it. Without that revoke, any signed-in user could
 * call privileged functions through it -- a far larger hole than the one it fills.
 *
 * `search_path = ''` so a schema planted on the search path cannot substitute its own
 * `decrypted_secrets` and harvest the key.
 */
create or replace function public.invoke_edge_function(p_name text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_url text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'service_role_key';

  if v_key is null then
    raise exception 'Vault secret "service_role_key" is missing; add it in Dashboard -> Integrations -> Vault';
  end if;

  v_url := 'https://xamyixuipbkyzssvxchc.supabase.co/functions/v1/' || p_name;

  return net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body    := p_body,
    -- Longer than the function's own ceiling, so a slow run is recorded rather than cut off
    -- here. pg_net does not wait for the reply in any case; this only bounds the socket.
    timeout_milliseconds := 170000
  );
end;
$$;

revoke execute on function public.invoke_edge_function(text, jsonb) from public;
revoke execute on function public.invoke_edge_function(text, jsonb) from anon, authenticated;

-- ---------------------------------------------------------------- the schedule

-- Times are UTC. 07:00 is chosen for being outside the hours anyone here is browsing, and
-- after the marketplaces have settled the previous day.
--
-- Two runs rather than one. A single invocation prices at most 400 cards -- a limit that
-- exists because an Edge Function is killed at 150 seconds and a killed run records
-- nothing -- and it skips cards that already have today's price, so the second run finishes
-- whatever the first did not and costs almost nothing when there is nothing left. 800
-- cards a day is far above the current 3, and the way to raise it later is another hour in
-- the list, not a bigger batch: the batch size is pinned to the time limit, not to taste.
select cron.unschedule('daily-price-capture')
where exists (select 1 from cron.job where jobname = 'daily-price-capture');

select cron.schedule(
  'daily-price-capture',
  '0 7,8 * * *',
  $cron$ select public.invoke_edge_function('sync-prices'); $cron$
);

-- The sweep deletes anonymous accounts that are over a day old and hold nothing. Daily,
-- because the cutoff is 24 hours: a weekly sweep would leave six days of accounts standing
-- that the cutoff says should be gone.
--
-- 04:20 rather than 04:00: a cron table where everything starts on the hour is a cron table
-- where everything contends on the hour.
select cron.unschedule('sweep-anonymous-accounts')
where exists (select 1 from cron.job where jobname = 'sweep-anonymous-accounts');

select cron.schedule(
  'sweep-anonymous-accounts',
  '20 4 * * *',
  $cron$ select public.invoke_edge_function('sweep-anonymous'); $cron$
);
