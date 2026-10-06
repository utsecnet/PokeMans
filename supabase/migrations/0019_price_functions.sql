-- Reading prices: what a card is worth now, and what it has been worth.
--
-- The table under these is deliberately sparse -- a row only where the price moved -- so
-- every function here is responsible for turning gaps back into a continuous series. A
-- caller must never have to know that Tuesday is missing because Tuesday was the same as
-- Monday.

-- ---------------------------------------------------------------- one price, now

-- What a single printing is worth, for collection totals.
--
-- security invoker is deliberate: prices are shared reference data and every signed-in
-- account may read them, so this needs no elevation. The caller's own grants apply.
create or replace function public.entry_price(p_card_id text, p_variant integer)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select pl.market
  from public.price_latest pl
  where p_variant is not null
    and pl.card_id = p_card_id
    and pl.variant_position = p_variant::smallint
    and pl.market is not null
  limit 1;
$$;

-- ---------------------------------------------------------------- the chart

/**
 * Every price a card has had, as a continuous daily series per printing.
 *
 * The carry-forward is the whole point. price_point holds a row only where the value
 * changed, so a printing priced on the 1st and again on the 9th has two rows and seven
 * implied days between them. Drawing that honestly means emitting all nine days with the
 * 1st's value repeated -- not a line that leaps between two distant points, and not a gap.
 *
 * generate_series produces the calendar, a lateral picks the newest point at or before each
 * day, and the result is dense even though the storage is not. Cost is bounded by the
 * window below rather than by how long the card has existed.
 *
 * Grouped by marketplace, and that grouping is structural. Each series carries its own
 * source and currency, and nothing in here ever puts two marketplaces into one list -- a
 * chart that mixed dollars and euros on one axis would be quietly wrong in a way a reader
 * could not see. Today there is one source; the shape does not assume it.
 */
create or replace function public.card_price_history(p_card_id text, p_days integer default 365)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      greatest(
        coalesce((select min(captured_on) from public.price_point where card_id = p_card_id),
                 current_date),
        current_date - (least(greatest(p_days, 1), 1825) || ' days')::interval
      )::date as from_day,
      current_date as to_day
  ),
  days as (
    select d::date as day from bounds b, generate_series(b.from_day, b.to_day, '1 day') d
  ),
  series as (
    -- The printings this card actually has prices for, with their marketplace.
    select distinct pp.card_id, pp.variant_position, pp.source_id
    from public.price_point pp
    where pp.card_id = p_card_id
  ),
  dense as (
    select
      s.variant_position,
      s.source_id,
      d.day,
      last_value.market,
      last_value.low
    from series s
    cross join days d
    -- The newest point at or before this day: the value that was in force, whether or not
    -- it was recorded on the day itself.
    left join lateral (
      select pp.market, pp.low
      from public.price_point pp
      where pp.card_id = s.card_id
        and pp.variant_position = s.variant_position
        and pp.source_id = s.source_id
        and pp.captured_on <= d.day
      order by pp.captured_on desc
      limit 1
    ) last_value on true
    -- Days before this printing's first price are genuinely unknown, not flat. Dropping
    -- them starts the line where the data starts instead of drawing an invented zero.
    where last_value.market is not null or last_value.low is not null
  )
  select coalesce(jsonb_agg(chart order by chart ->> 'label'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'sourceKey', ps.key,
      'label',     ps.label,
      'currency',  ps.currency,
      'printings', (
        select coalesce(jsonb_agg(printing order by printing ->> 'label'), '[]'::jsonb)
        from (
          select jsonb_build_object(
            'variantPosition', v.variant_position,
            'label', coalesce(
              (select tcv.type from public.tcg_card_variants tcv
               where tcv.card_id = p_card_id and tcv.position = v.variant_position),
              'Unknown'),
            'points', (
              select coalesce(jsonb_agg(
                jsonb_build_object('day', dd.day, 'market', dd.market, 'low', dd.low)
                order by dd.day), '[]'::jsonb)
              from dense dd
              where dd.variant_position = v.variant_position and dd.source_id = v.source_id
            )
          ) as printing
          from (select distinct variant_position, source_id from dense) v
          where v.source_id = ps.id
        ) printings
      )
    ) as chart
    from public.price_source ps
    where exists (select 1 from dense d2 where d2.source_id = ps.id)
  ) charts;
$$;

-- ---------------------------------------------------------------- health

/**
 * Whether the price data is in good order, for the admin dashboard.
 *
 * Coverage is the honest headline: how many of the printings we have a mapping for actually
 * carry a price. A sync that runs green every day while covering a third of the catalogue
 * is not healthy, and a run log alone would never say so.
 *
 * Staleness reads observed_on, not captured_on. A price that has not moved in six weeks is
 * perfectly healthy; a price nobody has looked at in six weeks is not. Those are different
 * questions and only the second one is a fault.
 */
create or replace function public.price_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'mappedPrintings',  (select count(*) from public.price_map),
    'totalPrintings',   (select count(*) from public.tcg_card_variants),
    'pricedPrintings',  (select count(*) from public.price_latest),
    'pricedToday',      (select count(*) from public.price_latest where observed_on = current_date),
    'staleOver3Days',   (select count(*) from public.price_latest where observed_on < current_date - 3),
    'historyRows',      (select count(*) from public.price_point),
    'oldestPoint',      (select min(captured_on) from public.price_point),
    'newestPoint',      (select max(captured_on) from public.price_point),
    'lastObserved',     (select max(observed_on) from public.price_latest)
  );
$$;

-- Admin-only: these say how the machinery is doing, which is not a browsing concern.
revoke execute on function public.price_health() from public, anon;
grant execute on function public.price_health() to authenticated, service_role;

grant execute on function public.entry_price(text, integer) to authenticated, service_role;
grant execute on function public.card_price_history(text, integer) to authenticated, service_role;
