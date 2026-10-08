-- Rebuild the price tables on the integer card reference.
--
-- Measured against 400,000 real rows, the text key costs 9.1 bytes per row more than an
-- integer once the index is counted -- about 26 MB across price_point, on a 500 MB ceiling.
-- The text id stays the public name of a card everywhere else; this is only where it was
-- being repeated 2.8 million times.
--
-- Copied rather than reloaded. The loader could rebuild this from the mirror in twenty
-- minutes, but a copy is one transaction: it either lands whole or leaves the old tables
-- exactly as they were. A reload would also re-derive the data and could quietly differ.
--
-- A second index arrives with it, on (source_id, captured_on). Three of the slowest things
-- in the system are range scans over dates -- the nightly thinning's band filters, and the
-- oldest and newest point on the admin dashboard, which between them were taking half a
-- minute of sequential scanning.

set local statement_timeout = '600s';

-- ---------------------------------------------------------------- the new shape

create table if not exists public.price_map_v2 (
  card_ref          integer  not null references public.tcg_cards (ref) on delete cascade,
  variant_position  smallint not null,
  source_id         smallint not null references public.price_source (id),
  external_id       bigint   not null,
  sub_type          text,
  matched_by        text     not null default 'number',
  mapped_at         timestamptz not null default now(),
  primary key (card_ref, variant_position, source_id)
);

create table if not exists public.price_point_v2 (
  card_ref          integer  not null references public.tcg_cards (ref) on delete cascade,
  variant_position  smallint not null,
  source_id         smallint not null references public.price_source (id),
  captured_on       date     not null,
  market            numeric(12,2),
  low               numeric(12,2),
  primary key (card_ref, variant_position, source_id, captured_on)
);

create table if not exists public.price_latest_v2 (
  card_ref          integer  not null references public.tcg_cards (ref) on delete cascade,
  variant_position  smallint not null,
  source_id         smallint not null references public.price_source (id),
  captured_on       date     not null,
  observed_on       date     not null,
  market            numeric(12,2),
  low               numeric(12,2),
  primary key (card_ref, variant_position, source_id)
);

-- ---------------------------------------------------------------- carry the data

insert into public.price_map_v2 (card_ref, variant_position, source_id, external_id, sub_type, matched_by, mapped_at)
select c.ref, m.variant_position, m.source_id, m.external_id, m.sub_type, m.matched_by, m.mapped_at
from public.price_map m join public.tcg_cards c on c.id = m.card_id;

insert into public.price_point_v2 (card_ref, variant_position, source_id, captured_on, market, low)
select c.ref, p.variant_position, p.source_id, p.captured_on, p.market, p.low
from public.price_point p join public.tcg_cards c on c.id = p.card_id;

insert into public.price_latest_v2 (card_ref, variant_position, source_id, captured_on, observed_on, market, low)
select c.ref, l.variant_position, l.source_id, l.captured_on, l.observed_on, l.market, l.low
from public.price_latest l join public.tcg_cards c on c.id = l.card_id;

-- A row that failed to find a card would be silently dropped by those joins, so check.
do $$
declare
  v_old bigint;
  v_new bigint;
begin
  select count(*) into v_old from public.price_point;
  select count(*) into v_new from public.price_point_v2;
  if v_old <> v_new then
    raise exception 'price_point lost rows in the copy: % before, % after', v_old, v_new;
  end if;
  select count(*) into v_old from public.price_map;
  select count(*) into v_new from public.price_map_v2;
  if v_old <> v_new then
    raise exception 'price_map lost rows in the copy: % before, % after', v_old, v_new;
  end if;
  select count(*) into v_old from public.price_latest;
  select count(*) into v_new from public.price_latest_v2;
  if v_old <> v_new then
    raise exception 'price_latest lost rows in the copy: % before, % after', v_old, v_new;
  end if;
end $$;

-- ---------------------------------------------------------------- swap

drop table public.price_point;
drop table public.price_latest;
drop table public.price_map;

alter table public.price_point_v2  rename to price_point;
alter table public.price_latest_v2 rename to price_latest;
alter table public.price_map_v2    rename to price_map;

-- ---------------------------------------------------------------- indexes

-- Lookups from an upstream product back to our printings, which is how a day's prices are
-- resolved.
create index if not exists price_map_external_idx
  on public.price_map (source_id, external_id, sub_type);

-- Date ranges. The nightly thinning filters whole bands by age, and the dashboard asks for
-- the oldest and newest point held; both were sequential scans of 2.8 million rows.
create index if not exists price_point_source_day_idx
  on public.price_point (source_id, captured_on);

-- Staleness, which the health panel reads.
create index if not exists price_latest_observed_idx
  on public.price_latest (source_id, observed_on);

-- ---------------------------------------------------------------- access

grant select on public.price_map, public.price_point, public.price_latest to authenticated;
grant select, insert, update, delete
  on public.price_map, public.price_point, public.price_latest to service_role;

alter table public.price_map    enable row level security;
alter table public.price_point  enable row level security;
alter table public.price_latest enable row level security;

create policy price_map_read    on public.price_map    for select to authenticated using (true);
create policy price_point_read  on public.price_point  for select to authenticated using (true);
create policy price_latest_read on public.price_latest for select to authenticated using (true);

analyze public.price_point;
analyze public.price_latest;
analyze public.price_map;
