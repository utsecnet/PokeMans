-- One marketplace, one currency, and rows only where a price actually moved.
--
-- What changed and why:
--
-- TCGdex priced one card per request, so a full catalogue run was 20,635 calls and never
-- happened -- only the handful of cards someone owned were ever priced. tcgcsv republishes
-- TCGplayer's own daily figures 220 requests at a time, so every card can be priced every
-- day. Cardmarket is deliberately not carried across: its catalogue has no card numbers,
-- only names like "Weedle [Multiply]", and a mapping built on names alone would be wrong in
-- ways nobody would notice. One source that is right beats two where one is a guess.
--
-- Everything below is therefore single-source, and the schema is narrow because storage is
-- the binding constraint: the free tier is 500 MB of database, and measurement in this very
-- project put a text-keyed row at 163 bytes against 103 for an integer-keyed one.

-- ---------------------------------------------------------------- the source

-- A lookup rather than a string on every row. Two bytes instead of eleven, and it gives the
-- UI one place to read a marketplace's name and currency from -- a chart must never put two
-- marketplaces' money on one axis, and this is what makes that structural rather than
-- remembered.
create table if not exists public.price_source (
  id        smallint primary key,
  key       text     not null unique,
  label     text     not null,
  currency  char(3)  not null
);

insert into public.price_source (id, key, label, currency)
values (1, 'tcgplayer', 'TCGplayer', 'USD')
on conflict (id) do update set label = excluded.label, currency = excluded.currency;

-- ---------------------------------------------------------------- the mapping

-- Our card ids are not TCGplayer's. This is the join, built once by a script that reports
-- what it could not match rather than guessing: 92.5% matched on set and card number, and
-- the rest is listed for a human instead of being silently approximated.
--
-- matched_by is kept so a later run can tell a confident match from a weak one, and so a
-- hand-made correction is never overwritten by the matcher.
create table if not exists public.price_map (
  card_id           text     not null references public.tcg_cards(id) on delete cascade,
  variant_position  smallint not null,
  source_id         smallint not null references public.price_source(id),
  external_id       bigint   not null,
  sub_type          text,
  matched_by        text     not null default 'number',
  mapped_at         timestamptz not null default now(),
  primary key (card_id, variant_position, source_id)
);

create index if not exists price_map_external_idx
  on public.price_map (source_id, external_id, sub_type);

-- ---------------------------------------------------------------- the prices

-- The history. A row exists only where the price differs from the one before it, which is
-- most of why this fits in the free tier at all: 77% of series are unchanged on any given
-- day, so storing every observation would cost four times as much for no extra information.
--
-- The gaps this leaves are not missing data. A price with no row for Tuesday was simply
-- still the Monday price, and the read function carries it forward, so a chart drawn from
-- this is continuous even though the table is sparse.
create table if not exists public.price_point (
  card_id           text     not null,
  variant_position  smallint not null,
  source_id         smallint not null references public.price_source(id),
  captured_on       date     not null,
  market            numeric(12,2),
  low               numeric(12,2),
  primary key (card_id, variant_position, source_id, captured_on)
);

-- The newest value per series, kept separately so a card page costs one indexed lookup
-- rather than a sort over its history.
--
-- Two dates, and the difference matters. captured_on is when the price became this value
-- and matches the history row; observed_on is the last run that saw it still holding. A
-- card whose price has not moved in a month has an old captured_on and a fresh observed_on,
-- and that is healthy. Old on both means the sync has stopped seeing the card at all, which
-- is not -- and without two dates those two cases look identical.
create table if not exists public.price_latest (
  card_id           text     not null,
  variant_position  smallint not null,
  source_id         smallint not null references public.price_source(id),
  captured_on       date     not null,
  observed_on       date     not null,
  market            numeric(12,2),
  low               numeric(12,2),
  primary key (card_id, variant_position, source_id)
);

create index if not exists price_latest_observed_idx
  on public.price_latest (source_id, observed_on);

-- ---------------------------------------------------------------- the run log

-- One row per source per job per day, which is what the admin dashboard's year of coloured
-- squares reads. A day with no row is not "fine", it is a day the job did not run, and the
-- grid shows that as a gap rather than inventing a green square for it.
create table if not exists public.sync_day (
  source_id     smallint not null references public.price_source(id),
  job           text     not null,
  ran_on        date     not null,
  status        text     not null check (status in ('ok', 'warn', 'error')),
  started_at    timestamptz,
  finished_at   timestamptz,
  series_seen   integer  not null default 0,
  rows_written  integer  not null default 0,
  failures      integer  not null default 0,
  duration_ms   integer,
  note          text,
  primary key (source_id, job, ran_on)
);

-- ---------------------------------------------------------------- retiring the old

-- The old tables carried a source text column and Cardmarket rows alongside TCGplayer ones.
-- Both are gone: the data was 137 rows of development testing, and keeping a shape that can
-- hold a marketplace we no longer collect would leave the door open to mixing them again.
--
-- fx_rates goes with them. It was built to convert between marketplace currencies and was
-- never once populated -- 0 rows -- so every price shown has always been in its source's
-- own currency. With a single USD source there is nothing left to convert, and an empty
-- table that looks like a feature is worse than no table.
drop function if exists public.record_prices(jsonb);
drop function if exists public.card_price_history(text);
drop table if exists public.price_history;
drop table if exists public.price_current;
drop table if exists public.fx_rates;

-- ---------------------------------------------------------------- access

-- Reads for signed-in accounts; writes for nobody. Prices arrive through Edge Functions
-- holding the service key, and no browser session may write them however the UI is driven.
-- anon is granted nothing at all, here as everywhere.
grant select on public.price_source, public.price_map, public.price_point,
                public.price_latest, public.sync_day to authenticated;
grant select, insert, update, delete on public.price_source, public.price_map,
                public.price_point, public.price_latest, public.sync_day to service_role;

alter table public.price_source enable row level security;
alter table public.price_map    enable row level security;
alter table public.price_point  enable row level security;
alter table public.price_latest enable row level security;
alter table public.sync_day     enable row level security;

-- Shared reference data: every signed-in account sees the same rows, which is the point.
create policy price_source_read  on public.price_source  for select to authenticated using (true);
create policy price_map_read     on public.price_map     for select to authenticated using (true);
create policy price_point_read   on public.price_point   for select to authenticated using (true);
create policy price_latest_read  on public.price_latest  for select to authenticated using (true);

-- The run log is operational, not public: it says when the machinery faltered, which is an
-- admin's business and nobody else's.
create policy sync_day_read on public.sync_day for select to authenticated
  using (public.is_admin());
