-- =====================================================================================
-- PokéMans — the admin role
--
-- One person (you) can refresh the shared card catalogue and prices. Everyone else only
-- reads them. This file creates the way the database knows which is which.
--
-- Run in the Supabase SQL editor, or via `supabase db push`. Idempotent.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- user_roles — who is an admin.
--
-- A table rather than a flag on the user, because Supabase's auth.users is managed by the
-- platform and adding columns to it is asking for trouble on an upgrade.
-- -------------------------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  role        text not null,
  granted_at  timestamptz not null default now(),

  constraint user_roles_known_role check (role in ('admin'))
);

-- =====================================================================================
-- This table is unreachable through the API, on purpose.
--
-- RLS is enabled and NOT ONE policy is created for it. With RLS on, no policy means no
-- access, so neither a signed-out visitor nor a signed-in user nor you-in-a-browser can
-- read it, add to it, or change it. The only thing that can is the service role, which
-- bypasses RLS: the SQL editor in your Supabase dashboard, and server-side functions.
--
-- That is the point. Admin cannot be granted by anything a browser does, so no bug in the
-- app and no compromised account can promote anyone. Granting it is a deliberate act you
-- perform in the dashboard, and the `granted_at` column records when.
--
-- To make yourself an admin, sign in to the app once so your user exists, then run this
-- in the SQL editor (Supabase dashboard → SQL Editor):
--
--   insert into public.user_roles (user_id, role)
--   select id, 'admin' from auth.users where email = 'rjohnson@utsec.net'
--   on conflict (user_id) do nothing;
--
-- Check it worked:
--
--   select u.email, r.role, r.granted_at
--   from public.user_roles r join auth.users u on u.id = r.user_id;
-- =====================================================================================
alter table public.user_roles enable row level security;

-- Belt and braces. Supabase grants table privileges to anon and authenticated by default
-- on new tables in `public`; RLS already blocks them, but removing the grant means even a
-- policy added here by mistake could not open this table up.
revoke all on table public.user_roles from anon, authenticated;

-- -------------------------------------------------------------------------------------
-- is_admin() — the question every admin-only rule asks.
--
-- `security definer` means it runs with the privileges of whoever created it rather than
-- the caller's, which is what lets it read user_roles when the caller cannot. That is a
-- deliberate, narrow hole: the function takes no arguments, reads one row, and returns a
-- boolean, so there is nothing to subvert through it.
--
-- `set search_path = ''` is not optional with security definer. Without it, a caller who
-- can create objects could put their own `user_roles` table earlier in the search path and
-- have this function read theirs instead. Every name inside is therefore fully qualified.
--
-- `stable` lets Postgres call it once per statement instead of once per row.
-- -------------------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = 'admin'
  );
$$;

-- The app calls this to decide whether to show the admin page at all. Signed-out visitors
-- have nothing to show, so they do not get it.
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- =====================================================================================
-- What this does NOT do
--
-- It does not let the admin page write to the catalogue from a browser. The sync needs the
-- provider API key and write access to 20,000 rows; both stay server-side, and the shared
-- tables have no write policy at all (see 0003_catalogue.sql). is_admin() decides who may
-- *ask* for a sync and who sees the admin page — the work itself happens in a function
-- holding the service role, where no browser can reach the keys.
-- =====================================================================================
