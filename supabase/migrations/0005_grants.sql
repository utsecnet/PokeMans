-- =====================================================================================
-- PokéMans — table privileges for signed-in users
--
-- Fixes a gap in 0001 through 0004: they enabled row level security and wrote policies,
-- but never granted the underlying table privileges. The result was a database nobody
-- could use — every query from a signed-in user returned
--
--   42501: permission denied for table collection_boxes
--
-- Run in the Supabase SQL editor, or via `supabase db push`. Idempotent.
-- =====================================================================================

-- =====================================================================================
-- Why both a grant and a policy are needed
--
-- These are two separate gates and a query must pass both.
--
--   GRANT   decides whether the role may touch the table at all. Without it, Postgres
--           refuses before any row is considered, and the caller gets 42501.
--   POLICY  decides which rows that role may see or change, once it is past the grant.
--
-- A policy is a filter, not a key. `using (user_id = auth.uid())` narrows a permission
-- that the role already holds; it cannot conjure one. So granting broadly here does not
-- widen access — every row still has to satisfy the policies written in 0001 and 0003.
--
-- Supabase usually applies default privileges that make this invisible, which is how the
-- omission survived four migrations and a verification pass that counted tables, policies
-- and revoked grants. It counted everything except the privilege that makes a policy
-- reachable. What caught it was signing in as two users and actually trying.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- Shared reference data: read only, for anyone holding a session.
--
-- Read is all that is granted, so there is no write path for a user to abuse — not even
-- for the admin, whose browser is just another signed-in session. The sync writes with
-- the service role, which bypasses all of this.
-- -------------------------------------------------------------------------------------
do $grants$
declare
  t text;
begin
  for t in
    select unnest(array[
      'types', 'abilities', 'pokemon', 'pokemon_types', 'pokemon_abilities',
      'stats', 'evolutions',
      'tcg_series', 'tcg_sets', 'tcg_cards', 'tcg_card_variants',
      'tcg_card_pokemon', 'tcg_card_types',
      'price_current', 'price_history', 'fx_rates',
      -- Both sync tables are granted here but their policies admit only an admin, so a
      -- normal user passes the grant and then matches no rows.
      'sync_log', 'sync_run'
    ])
  loop
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end
$grants$;

-- -------------------------------------------------------------------------------------
-- Personal data: full access, narrowed to your own rows by the policies in 0001.
-- -------------------------------------------------------------------------------------
do $grants$
declare
  t text;
begin
  for t in
    select unnest(array[
      'collection_boxes', 'collection_entries',
      'want_lists', 'want_list_entries',
      'user_settings'
    ])
  loop
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end
$grants$;

-- -------------------------------------------------------------------------------------
-- The service role: everything, on every table.
--
-- This is the role the sync and the import run as, and it is the only one that may write
-- to the shared tables. It is often assumed to need no grants because it bypasses row
-- level security — but bypassing policies is not the same as holding privileges. It still
-- has to get past the grant, and on this project it never had one: the import failed with
-- the same 42501 that signed-in users hit, for the same reason.
--
-- Supabase's default privileges normally make all of this invisible. They did not apply
-- to these tables, so every role had to be granted explicitly.
-- -------------------------------------------------------------------------------------
do $service$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end
$service$;

-- =====================================================================================
-- Unchanged: nothing is granted to the signed-out role, and nothing at all reaches
-- user_roles. Restated rather than assumed, so this file cannot quietly undo them.
-- =====================================================================================
do $revokes$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end
$revokes$;

revoke all on table public.user_roles from anon, authenticated;
