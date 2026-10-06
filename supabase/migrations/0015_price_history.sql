-- =====================================================================================
-- PokéMans — a card's recorded prices, as the chart wants them
--
-- Replaces GET /api/cards/:id/price-history.
--
-- One chart per marketplace, each in its own currency. The server produced one chart per
-- *service* and converted everything to a single display currency using fx_rates; both
-- change here, and deliberately.
--
-- The schema no longer records a service — `source` is the marketplace, which is the
-- distinction that actually matters: the same printing quoted by TCGplayer and by
-- Cardmarket is two different quotes, not one series with noise in it.
--
-- And they are left in the currency they were quoted in. TCGplayer publishes dollars,
-- Cardmarket euros, and converting one into the other needs a rate for the day each price
-- was captured — fx_rates holds none yet. Drawing a euro series on a dollar axis because
-- today's rate was handy would make the history say something that was never true. Each
-- chart carries its own currency and the axis follows.
--
-- Run in the Supabase SQL editor, or via `supabase db push`. Idempotent.
-- =====================================================================================

create or replace function public.card_price_history(p_card_id text)
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select json_build_object(
    'cardId', p_card_id,
    -- The reader's preferred currency, for anything that wants to name one. Each chart
    -- states the currency it is actually drawn in, which is the one that matters.
    'currency', coalesce(
      (select value from public.user_settings where key = 'display.currency'), 'USD'),
    -- Nothing is dropped for want of a rate, because nothing is converted.
    'ratesUnavailable', false,
    -- Grouped twice, innermost first: by printing to gather that series' points, then by
    -- marketplace to gather its series. Doing it in one pass would repeat a series once
    -- per point it contains.
    'charts', coalesce((
      select json_agg(json_build_object(
               'service', chart.source,
               'currency', chart.currency,
               'series', chart.series
             ) order by chart.source)
      from (
        select
          per_printing.source,
          min(per_printing.currency) as currency,
          json_agg(json_build_object(
            'variantPosition', per_printing.variant_position,
            'marketplace', per_printing.source,
            'condition', null,
            'points', per_printing.points
          ) order by per_printing.variant_position) as series
        from (
          select
            h.source,
            h.variant_position,
            min(h.currency) as currency,
            json_agg(json_build_object('date', h.captured_on, 'market', h.market)
                     order by h.captured_on) as points
          from public.price_history h
          where h.card_id = p_card_id and h.market is not null
          group by h.source, h.variant_position
        ) per_printing
        group by per_printing.source
      ) chart
    ), '[]'::json)
  );
$$;

revoke all on function public.card_price_history(text) from public, anon;
grant execute on function public.card_price_history(text) to authenticated, service_role;
