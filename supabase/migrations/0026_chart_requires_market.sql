-- A printing with no market price is left off the chart rather than drawn at nothing.
--
-- Some products carry a low price and no market price at all. A 1st Edition Base Charizard
-- is the clear case: too rare to have recent sales, so TCGplayer publishes no market figure
-- and a lowest-listing of $100,000, which is one seller's asking price rather than a value.
--
-- Plotting that is worse than plotting nothing. Drawing the low as though it were the market
-- puts a six-figure line on the chart; letting a null become zero -- which the client did --
-- puts the line on the floor. Both read as fact. A printing that simply does not appear
-- invites the reader to go and look, which is the correct outcome when nobody knows what the
-- card is worth.
--
-- The low is still carried for printings that do have a market price, where it is the band
-- around the line and means something.
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
    select distinct pp.card_id, pp.variant_position, pp.source_id
    from public.price_point pp
    where pp.card_id = p_card_id
      -- A printing needs at least one real market price somewhere in its history to be
      -- worth a line at all.
      and exists (
        select 1 from public.price_point q
        where q.card_id = pp.card_id
          and q.variant_position = pp.variant_position
          and q.source_id = pp.source_id
          and q.market is not null
      )
  ),
  dense as (
    select s.variant_position, s.source_id, d.day, last_value.market, last_value.low
    from series s
    cross join days d
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
    -- Days before the first market price are unknown rather than flat, so the line starts
    -- where the data does.
    where last_value.market is not null
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

grant execute on function public.card_price_history(text, integer) to authenticated, service_role;
