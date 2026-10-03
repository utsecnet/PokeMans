-- =====================================================================================
-- PokéMans — shared price and currency data (Supabase / Postgres)
--
-- Scope: the "shared and live" bucket only. Card and Pokédex metadata is shared but
-- static — it changes a handful of times a year, when a set drops — so it is downloaded
-- to the device and queried locally rather than round-tripped per keystroke. Collections,
-- want lists and settings are user data and are not here at all.
--
-- Run this in the Supabase SQL editor. It is idempotent.
-- =====================================================================================

-- =====================================================================================
-- Why two tables and not one
--
-- Writes are delta-only: measured against the app's own history, 87.3% of consecutive-day
-- prices are *exactly* unchanged (median day-over-day move: 0.00%), so storing every day
-- for every card would be ~8x the rows for no extra information.
--
-- But delta-only makes the commonest read hard. "What does this card cost today" stops
-- being `WHERE captured_on = today` and becomes "the most recent row at or before today",
-- which for a bulk common might be six weeks back — a latest-row-per-group scan against a
-- table heading for millions of rows, run on every card grid.
--
-- So: price_current is overwritten in full every run and answers that question with a
-- primary-key hit. price_history is append-only and delta-only, and is touched only when
-- someone opens a chart. Neither table can do the other's job well.
-- =====================================================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------------------------
-- price_current — one row per priced thing. Fixed size (~39k rows), never grows.
--
-- The grain is (card, printing, marketplace). A card can exist in several printings worth
-- very different amounts — a 1st Edition Shadowless Charizard against an Unlimited one is
-- roughly 7x — so collapsing to one price per card would be wrong, not merely imprecise.
-- -------------------------------------------------------------------------------------
create table if not exists public.price_current (
  card_id           text        not null,
  -- Index into the card's printings, matching tcg_card_variants.position on the device.
  -- Not a foreign key: the catalogue lives on the client, so there is nothing here to
  -- reference. An id that stops existing after a resync is skipped when rendering.
  variant_position  smallint    not null,
  -- 'tcgplayer' | 'cardmarket'. The marketplace, not the API that reported it.
  source            text        not null,
  currency          char(3)     not null,
  market            numeric(12,2),
  low               numeric(12,2),
  -- The day this price is *for*, which is not the same as when we wrote the row: an
  -- unchanged price keeps its original captured_on in price_history but gets a fresh one
  -- here, so the client can tell "still 40 dollars today" from "last seen at 40 in July".
  captured_on       date        not null,
  updated_at        timestamptz not null default now(),
  primary key (card_id, variant_position, source)
);

comment on table public.price_current is
  'Latest known price per card, printing and marketplace. Upserted in full on every run, '
  'including for prices that did not change, so a lookup is always a primary-key hit.';

-- The card grid asks for ~60 cards at once; this is the access path for that.
create index if not exists price_current_card_idx
  on public.price_current (card_id);

-- -------------------------------------------------------------------------------------
-- price_history — append-only, delta-only. ~5k rows/day, ~1.8M/year.
--
-- A row exists only where the price differed from the previous known value, so the series
-- is a step function: each row holds until the next one. Anything drawing this as a plain
-- line chart will invent a smooth ramp across the gaps that never happened.
-- -------------------------------------------------------------------------------------
create table if not exists public.price_history (
  id                bigint generated always as identity primary key,
  card_id           text        not null,
  variant_position  smallint    not null,
  source            text        not null,
  currency          char(3)     not null,
  market            numeric(12,2),
  low               numeric(12,2),
  captured_on       date        not null,
  -- One row per grain per day at most. Makes the daily job safely re-runnable: a second
  -- pass on the same day collides and does nothing rather than doubling the series.
  unique (card_id, variant_position, source, captured_on)
);

comment on table public.price_history is
  'Price changes only. A row means the price differed from the previous known value; '
  'between rows the price held. Render as a step series, not a line.';

-- Charts read one card's whole series, newest first.
create index if not exists price_history_series_idx
  on public.price_history (card_id, variant_position, source, captured_on desc);

-- -------------------------------------------------------------------------------------
-- sync_run — did the job actually run, and what did it find.
--
-- Worth a table because the failure mode is silent. GitHub's `schedule:` trigger is
-- best-effort, routinely late, and disables itself after 60 days of repository inactivity;
-- a price day missed is a price day gone, because the upstreams only ever serve today's
-- number. Without this you find out months later, from a hole in a chart.
-- -------------------------------------------------------------------------------------
create table if not exists public.sync_run (
  id            uuid        primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  cards_seen    integer     not null default 0,
  prices_read   integer     not null default 0,
  changed       integer     not null default 0,
  failed        integer     not null default 0,
  status        text        not null default 'running',
  error         text,
  constraint sync_run_status_ck check (status in ('running', 'success', 'partial', 'error'))
);

create index if not exists sync_run_started_idx
  on public.sync_run (started_at desc);

-- =====================================================================================
-- fx_rates — currency conversion, by day.
--
-- Moved here from the single-user database, where it sat among personal data despite
-- being nothing of the kind: an exchange rate is a fact about a day, identical for every
-- user. Hosted, one fetch serves everyone.
--
-- The original column was named `date`. Renamed to `as_of`, because a column called
-- `date` of type `date` has to be quoted in half the places it appears.
-- =====================================================================================
create table if not exists public.fx_rates (
  as_of  date not null,
  base   char(3) not null,
  quote  char(3) not null,
  rate   numeric(18,8) not null,
  primary key (as_of, base, quote)
);

-- "the latest rate for this pair" is the only question asked of it.
create index if not exists fx_rates_recent_idx
  on public.fx_rates (base, quote, as_of desc);

-- =====================================================================================
-- Row level security
--
-- Revised from the original rule, which granted nothing to anyone and left public read
-- commented out. That was the right call while the anon key was the only key: a read
-- policy for `anon` would have published free-tier price data to anyone who found the
-- site, and the anon key ships inside the web page.
--
-- The access model now draws a line the original could not. Every visitor holds a real
-- account on arrival, including one who never signs up, so reads go to `authenticated`
-- while `anon` — the signed-out role — still gets nothing. Prices are readable by people
-- using the app, and there is no endpoint to script against without first obtaining an
-- account, which is rate-limited and CAPTCHA-gated.
--
-- Writes stay shut to everyone. The sync holds the service role and bypasses RLS.
-- =====================================================================================
alter table public.price_current enable row level security;
alter table public.price_history enable row level security;
alter table public.fx_rates      enable row level security;
alter table public.sync_run      enable row level security;

revoke all on table public.price_current, public.price_history,
                    public.fx_rates, public.sync_run from anon;

drop policy if exists price_current_read_signed_in on public.price_current;
create policy price_current_read_signed_in on public.price_current
  for select to authenticated using (true);

drop policy if exists price_history_read_signed_in on public.price_history;
create policy price_history_read_signed_in on public.price_history
  for select to authenticated using (true);

drop policy if exists fx_rates_read_signed_in on public.fx_rates;
create policy fx_rates_read_signed_in on public.fx_rates
  for select to authenticated using (true);

-- sync_run records how the service is operated rather than what a card costs. Admin only,
-- using the helper from 0002_admin.sql — so that migration must run before this one.
drop policy if exists sync_run_read_admin on public.sync_run;
create policy sync_run_read_admin on public.sync_run
  for select to authenticated using (public.is_admin());


-- =====================================================================================
-- The write path, as one call per batch.
--
-- Takes a batch of scraped prices as JSON, upserts every one into price_current, and
-- inserts into price_history only those whose market or currency actually moved. Doing the
-- comparison inside the database means the job never has to fetch the previous values
-- across the network to diff them — it posts what it scraped and Postgres decides what is
-- new. Returns how many rows changed, which is what sync_run records.
-- =====================================================================================
create or replace function public.record_prices(payload jsonb)
returns integer
language plpgsql
security invoker
as $$
declare
  changed_count integer;
begin
  create temporary table _incoming (
    card_id          text,
    variant_position smallint,
    source           text,
    currency         char(3),
    market           numeric(12,2),
    low              numeric(12,2),
    captured_on      date
  ) on commit drop;

  insert into _incoming
  select
    x.card_id, x.variant_position, x.source, x.currency, x.market, x.low, x.captured_on
  from jsonb_to_recordset(payload) as x(
    card_id text, variant_position smallint, source text,
    currency char(3), market numeric(12,2), low numeric(12,2), captured_on date
  );

  -- History first, while price_current still holds the previous values to compare against.
  -- `is distinct from` rather than `<>` so a price appearing or disappearing counts as a
  -- change; with `<>` a null on either side makes the whole comparison null, and the row
  -- would be silently dropped.
  with changed as (
    insert into public.price_history
      (card_id, variant_position, source, currency, market, low, captured_on)
    select i.card_id, i.variant_position, i.source, i.currency, i.market, i.low, i.captured_on
    from _incoming i
    left join public.price_current c
      on c.card_id = i.card_id
     and c.variant_position = i.variant_position
     and c.source = i.source
    where c.card_id is null
       or c.market   is distinct from i.market
       or c.currency is distinct from i.currency
    on conflict (card_id, variant_position, source, captured_on) do nothing
    returning 1
  )
  select count(*) into changed_count from changed;

  insert into public.price_current
    (card_id, variant_position, source, currency, market, low, captured_on, updated_at)
  select i.card_id, i.variant_position, i.source, i.currency, i.market, i.low, i.captured_on, now()
  from _incoming i
  on conflict (card_id, variant_position, source) do update
    set currency    = excluded.currency,
        market      = excluded.market,
        low         = excluded.low,
        captured_on = excluded.captured_on,
        updated_at  = now();

  return changed_count;
end;
$$;

comment on function public.record_prices(jsonb) is
  'Upserts a batch into price_current and appends only genuine changes to price_history. '
  'Returns the number of changed rows.';

-- record_prices rewrites every price in the system, so nothing holding a browser key may
-- call it. Execute is left only to the service role, which the sync function uses.
revoke all on function public.record_prices(jsonb) from public, anon, authenticated;
