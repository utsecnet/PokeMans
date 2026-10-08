-- One line per price, not one line per printing.
--
-- The two catalogues disagree about how finely a card divides. TCGdex splits Base Set
-- Charizard into four printings -- Unlimited, Shadowless, Shadowless 1st Edition, and the
-- 1999-2000 copyright run -- while TCGplayer sells two products. Two of our printings
-- therefore point at the same product and can only ever carry the same number, and drawing
-- them as separate lines claims two independently traded cards where there is one.
--
-- It is not a curiosity: 2,053 cards are affected, 2,960 printings of 32,106.
--
-- So the series is keyed by the upstream product it is priced from rather than by our
-- printing, and the printings that share one are reported together. Nothing is hidden --
-- the label names every printing the price covers, so a collector looking for "1999-2000
-- Copyright" still finds it, sharing a line with Unlimited and saying so.
--
-- A printing with no mapping keeps a key of its own, so it is never silently folded into
-- another card's price.
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
  stride as (
    select greatest(1, ceil(((to_day - from_day + 1)::numeric) / 400))::int as step,
           from_day, to_day
    from bounds
  ),
  days as (
    select d::date as day from stride s, generate_series(s.from_day, s.to_day, '1 day') d
  ),
  -- Each stored printing, tagged with the upstream product that prices it.
  tagged as (
    select distinct
      pp.card_id,
      pp.variant_position,
      pp.source_id,
      coalesce(pm.external_id::text || '~' || coalesce(pm.sub_type, ''),
               'unmapped~' || pp.variant_position) as price_key
    from public.price_point pp
    left join public.price_map pm
      on pm.card_id = pp.card_id
     and pm.variant_position = pp.variant_position
     and pm.source_id = pp.source_id
    where pp.card_id = p_card_id
      and exists (
        select 1 from public.price_point q
        where q.card_id = pp.card_id
          and q.variant_position = pp.variant_position
          and q.source_id = pp.source_id
          and q.market is not null
      )
  ),
  -- One row per distinct price: the printings it covers, and one of them to read from.
  grouped as (
    select
      price_key,
      source_id,
      min(variant_position) as read_from,
      array_agg(variant_position order by variant_position) as positions
    from tagged
    group by price_key, source_id
  ),
  dense as (
    select g.price_key, g.source_id, g.positions, d.day, last_value.market, last_value.low
    from grouped g
    cross join days d
    left join lateral (
      select pp.market, pp.low
      from public.price_point pp
      where pp.card_id = p_card_id
        and pp.variant_position = g.read_from
        and pp.source_id = g.source_id
        and pp.captured_on <= d.day
      order by pp.captured_on desc
      limit 1
    ) last_value on true
    where last_value.market is not null
  ),
  thinned as (
    select d.*
    from (
      select dense.*,
             row_number() over (partition by price_key, source_id order by day) as seq,
             count(*) over (partition by price_key, source_id) as total
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
      -- What the figure actually measures. TCGplayer publishes a market price per
      -- condition and this is the Near Mint one, which is why it can sit well above the
      -- cheapest listing on their own product page.
      'basis',     ps.price_basis,
      'printings', (
        select coalesce(jsonb_agg(printing order by printing -> 'variantPositions' -> 0), '[]'::jsonb)
        from (
          select jsonb_build_object(
            -- Kept for callers that key off a single printing; it is the lowest position
            -- in the group.
            'variantPosition', (v.positions)[1],
            'variantPositions', to_jsonb(v.positions),
            'points', (
              select coalesce(jsonb_agg(
                jsonb_build_object('day', tt.day, 'market', tt.market, 'low', tt.low)
                order by tt.day), '[]'::jsonb)
              from thinned tt
              where tt.price_key = v.price_key and tt.source_id = v.source_id
            )
          ) as printing
          from (select distinct price_key, source_id, positions from thinned) v
          where v.source_id = ps.id
        ) printings
      )
    ) as chart
    from public.price_source ps
    where exists (select 1 from thinned t2 where t2.source_id = ps.id)
  ) charts;
$$;

grant execute on function public.card_price_history(text, integer) to authenticated, service_role;
