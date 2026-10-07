-- Cap how many points a chart returns, however long the window.
--
-- card_price_history emits one point per calendar day, which is what makes a sparse table
-- draw as an unbroken line. Over a few months that is cheap. Over the full history it is
-- not: two and a half years is roughly 950 points per printing, and a card with four
-- printings sends about 230 KB to draw a chart 460 pixels wide, where all but 460 of those
-- points land on a pixel some other point already occupied.
--
-- So the series is strided when the window is long enough to need it. The stride is chosen
-- from the span, the first and last days are always kept, and the result is visually
-- identical because the points dropped were never separately visible.
--
-- The carry-forward still happens first, at full daily resolution. Striding a dense series
-- samples the price that was in force on the days it keeps; striding the raw rows instead
-- would skip changes entirely and move the line.
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
  -- At most this many points per printing. A chart is a few hundred pixels wide, so beyond
  -- this the extra points are not drawable, let alone readable.
  stride as (
    select greatest(1, ceil(((to_day - from_day + 1)::numeric) / 400))::int as step,
           from_day, to_day
    from bounds
  ),
  days as (
    select d::date as day from stride s, generate_series(s.from_day, s.to_day, '1 day') d
  ),
  series as (
    select distinct pp.card_id, pp.variant_position, pp.source_id
    from public.price_point pp
    where pp.card_id = p_card_id
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
    where last_value.market is not null
  ),
  thinned as (
    -- Keep every step-th day, plus whichever days are first and last for this printing, so
    -- the line still begins and ends where the data does.
    select d.*
    from (
      select dense.*,
             row_number() over (partition by variant_position, source_id order by day) as seq,
             count(*) over (partition by variant_position, source_id) as total
      from dense
    ) d, stride st
    where (d.seq - 1) % st.step = 0 or d.seq = 1 or d.seq = d.total
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
                jsonb_build_object('day', tt.day, 'market', tt.market, 'low', tt.low)
                order by tt.day), '[]'::jsonb)
              from thinned tt
              where tt.variant_position = v.variant_position and tt.source_id = v.source_id
            )
          ) as printing
          from (select distinct variant_position, source_id from thinned) v
          where v.source_id = ps.id
        ) printings
      )
    ) as chart
    from public.price_source ps
    where exists (select 1 from thinned t2 where t2.source_id = ps.id)
  ) charts;
$$;

grant execute on function public.card_price_history(text, integer) to authenticated, service_role;
