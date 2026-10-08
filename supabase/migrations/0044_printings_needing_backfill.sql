-- Which printings have no real history, so a backfill can load only those.
--
-- A printing gains a mapping long after the rest -- a set that was matched wrongly and then
-- corrected, a promo whose product was only just found -- and from that day it has a price
-- but no past. Re-running the whole loader to fill a few hundred of them would rewrite two
-- and a half years for all 32,265, and because the loader's change detection starts empty
-- it would write a row for every printing on the first sampled day whether or not the value
-- had moved. On a database at two thirds of its ceiling that is not a small mistake.
--
-- Answered in Postgres rather than by paging price_point through PostgREST, which caps a
-- response at a thousand rows and would mean 2,800 requests to group 2.8 million rows the
-- database can group in one.
create or replace function public.printings_needing_backfill(p_source_id smallint default 1)
returns table (card_ref integer, variant_position smallint)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
  select pm.card_ref, pm.variant_position
  from public.price_map pm
  where pm.source_id = p_source_id
    and coalesce((
      select min(pp.captured_on)
      from public.price_point pp
      where pp.card_ref = pm.card_ref
        and pp.variant_position = pm.variant_position
        and pp.source_id = p_source_id
    ), public.app_today()) >= public.app_today() - 1
  order by pm.card_ref, pm.variant_position;
$$;

revoke execute on function public.printings_needing_backfill(smallint) from public, anon, authenticated;
grant execute on function public.printings_needing_backfill(smallint) to service_role;
