-- =====================================================================================
-- PokéMans — let the sync function write prices
--
-- 0004 revoked execute on record_prices from public, anon and authenticated, which was
-- right: nothing holding a browser key should be able to rewrite every price in the
-- system. It left service_role with nothing either, because the default grant it revoked
-- was the one to PUBLIC that service_role inherited.
--
-- The sync-prices Edge Function runs as service_role and calls this, so it needs the
-- grant back — explicitly, to that role alone.
-- =====================================================================================
grant execute on function public.record_prices(jsonb) to service_role;

-- The same gap, for the one piece of state the Edge Function writes directly. 0005 granted
-- service_role every table privilege, so this is already covered; restated here so the
-- function's requirements are readable in one place rather than inferred from two files.
grant select, insert, update on table public.sync_run to service_role;
