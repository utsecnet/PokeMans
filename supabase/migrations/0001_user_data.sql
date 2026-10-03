-- =====================================================================================
-- PokéMans — user data (Supabase / Postgres)
--
-- Scope: the per-user bucket only. Collections, want lists and settings — everything that
-- belongs to one person and must never be visible to another. Card and Pokédex metadata
-- and prices are shared facts and are not here; those tables carry no user_id at all.
--
-- Run in the Supabase SQL editor, or via `supabase db push`. Idempotent.
-- =====================================================================================

-- =====================================================================================
-- What changes moving from one user to many
--
-- The SQLite original is single-user, and two of its constraints silently assume that:
--
--   collection_boxes.name TEXT NOT NULL UNIQUE
--   want_lists.name       TEXT NOT NULL UNIQUE
--
-- Carried over as-is, the first person to make a box called "Binder 1" would stop everyone
-- else from ever making one. Both become unique *per user* below.
--
-- The child tables (entries) also gain their own user_id, duplicating the parent's. That
-- is deliberate denormalisation for two reasons: an RLS policy can then authorise a row
-- without joining to its parent, and the composite foreign keys below make filing a card
-- into someone else's box structurally impossible rather than merely forbidden.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- collection_boxes — a named group of cards you own.
-- -------------------------------------------------------------------------------------
create table if not exists public.collection_boxes (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  name        text not null,
  type        text not null default 'box',
  color       text,
  icon        text,
  position    integer,
  created_at  timestamptz not null default now(),

  constraint collection_boxes_name_per_user unique (user_id, name),
  -- Not redundant with the primary key: a composite foreign key needs a unique
  -- constraint on exactly the columns it references. collection_entries uses it.
  constraint collection_boxes_id_user unique (id, user_id)
);

-- -------------------------------------------------------------------------------------
-- collection_entries — one card, in one box. No unique constraint on the card: owning
-- three copies of the same card is a real thing, and the original allowed it.
-- -------------------------------------------------------------------------------------
create table if not exists public.collection_entries (
  id               bigint generated always as identity primary key,
  user_id          uuid not null default auth.uid()
                     references auth.users (id) on delete cascade,
  box_id           bigint not null,
  card_id          text not null,
  variant_position integer,
  added_at         timestamptz not null default now(),

  -- The composite form, not a plain reference to collection_boxes(id). It makes the
  -- database refuse an entry whose box belongs to a different user, so a bug in the
  -- client or a mistake in a policy cannot produce cross-account data.
  constraint collection_entries_box_same_user
    foreign key (box_id, user_id)
      references public.collection_boxes (id, user_id) on delete cascade
);

create index if not exists collection_entries_box_idx
  on public.collection_entries (user_id, box_id);
-- "do I own this card" is asked once per tile across a whole grid.
create index if not exists collection_entries_card_idx
  on public.collection_entries (user_id, card_id);

-- -------------------------------------------------------------------------------------
-- want_lists — cards you are looking for. `query` and `live` carry the original meaning:
-- a list can be a snapshot of a Cards-browser filter, or re-run that filter and absorb
-- anything new that matches.
-- -------------------------------------------------------------------------------------
create table if not exists public.want_lists (
  id              bigint generated always as identity primary key,
  user_id         uuid not null default auth.uid()
                    references auth.users (id) on delete cascade,
  name            text not null,
  color           text,
  query           text,
  live            boolean not null default false,
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now(),

  constraint want_lists_name_per_user unique (user_id, name),
  constraint want_lists_id_user unique (id, user_id)
);

create table if not exists public.want_list_entries (
  id        bigint generated always as identity primary key,
  user_id   uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  list_id   bigint not null,
  card_id   text not null,
  state     text not null default 'want',
  added_at  timestamptz not null default now(),

  constraint want_list_entries_card_once unique (list_id, card_id),
  constraint want_list_entries_list_same_user
    foreign key (list_id, user_id)
      references public.want_lists (id, user_id) on delete cascade
);

create index if not exists want_list_entries_list_idx
  on public.want_list_entries (user_id, list_id);
create index if not exists want_list_entries_card_idx
  on public.want_list_entries (user_id, card_id);

-- -------------------------------------------------------------------------------------
-- user_settings — the key/value store the app already uses, scoped to a person.
--
-- `value` stays text rather than becoming jsonb, so the existing settings layer ports
-- without changing how it reads and writes. Today's keys: display.currency,
-- prices.lastRunAt, last_used_box_id.
--
-- Note what is NOT here: the old `linked_accounts` table held a provider API secret. In a
-- hosted app the *server* holds one key for everyone, so it belongs in a Supabase secret
-- read by the sync function — never in a table a client can reach.
-- -------------------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  key         text not null,
  value       text not null,
  updated_at  timestamptz not null default now(),

  primary key (user_id, key)
);

-- =====================================================================================
-- Row level security
--
-- Every table above is per-user, so every one gets the same shape: you may see and change
-- your own rows and nothing else. Notes on the shape itself:
--
-- * Policies are granted `to authenticated` only. The `anon` role gets nothing, so an
--   unauthenticated caller holding the public anon key sees an empty database.
--
-- * UPDATE carries both `using` and `with check`. `using` decides which rows you may
--   update; `with check` validates the row *after* the change. Without the second, a user
--   could update their own row and set user_id to someone else — handing the row away.
--
-- * The predicate is `(select auth.uid())`, not a bare `auth.uid()`. Wrapped in a
--   subquery, Postgres evaluates it once per statement rather than once per row, which on
--   a several-thousand-row collection is the difference between a fast scan and a slow one.
--
-- * The policies are generated in a loop rather than written out twenty times. That is
--   for uniformity, not brevity: a table silently missing one of the four is exactly the
--   kind of gap that hand-written blocks produce and nobody notices.
--
-- * Nothing here grants cross-user read. Sharing a collection publicly would be a new
--   policy plus an explicit per-row flag, not a loosening of these.
-- =====================================================================================

alter table public.collection_boxes   enable row level security;
alter table public.collection_entries enable row level security;
alter table public.want_lists         enable row level security;
alter table public.want_list_entries  enable row level security;
alter table public.user_settings      enable row level security;

-- Supabase grants the signed-out role a set of privileges on every new table in `public`.
-- RLS already denies it SELECT, INSERT, UPDATE and DELETE, since it holds no policy — but
-- the grant also carries TRUNCATE, and TRUNCATE is not subject to row level security at
-- all. Nothing exposes TRUNCATE through the REST API, so this was never reachable; it is
-- removed because a guard that depends on no one ever exposing it is not a guard.
revoke all on table public.collection_boxes, public.collection_entries,
                    public.want_lists, public.want_list_entries,
                    public.user_settings from anon;

do $policies$
declare
  t text;
begin
  for t in
    select unnest(array[
      'collection_boxes',
      'collection_entries',
      'want_lists',
      'want_list_entries',
      'user_settings'
    ])
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using (user_id = (select auth.uid()))',
      t || '_select_own', t);

    execute format(
      'create policy %I on public.%I for insert to authenticated '
      'with check (user_id = (select auth.uid()))',
      t || '_insert_own', t);

    execute format(
      'create policy %I on public.%I for update to authenticated '
      'using (user_id = (select auth.uid())) '
      'with check (user_id = (select auth.uid()))',
      t || '_update_own', t);

    execute format(
      'create policy %I on public.%I for delete to authenticated '
      'using (user_id = (select auth.uid()))',
      t || '_delete_own', t);
  end loop;
end
$policies$;
