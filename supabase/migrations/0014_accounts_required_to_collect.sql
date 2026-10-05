-- =====================================================================================
-- PokéMans — collecting requires an account
--
-- Browsing stays open to anyone: a visitor still receives an anonymous session on arrival
-- and can search all 20,635 cards. What they can no longer do is build anything with it.
--
-- The reason is not restriction for its own sake. An anonymous session lives in one
-- browser's storage and nowhere else — clear site data, switch device, or use a private
-- window, and the collection is gone with no way to recover it and nobody to ask. Letting
-- someone spend an evening cataloguing into a container that can evaporate is a worse
-- outcome than asking them to sign in first.
--
-- Enforced here as well as in the interface, because the interface is a courtesy. Anyone
-- can call PostgREST directly with the key from the page; the policy is what actually
-- decides.
--
-- Run in the Supabase SQL editor, or via `supabase db push`. Idempotent.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- is_real_account — signed in, and not just handed a session on arrival.
--
-- Reads the is_anonymous claim from the caller's own token rather than looking the user
-- up: the claim is signed, already present on every request, and costs nothing. A missing
-- claim is treated as anonymous, so a token that predates the claim cannot write.
-- -------------------------------------------------------------------------------------
create or replace function public.is_real_account()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean,
    true
  ) = false;
$$;

revoke all on function public.is_real_account() from public, anon;
grant execute on function public.is_real_account() to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- Creating anything now needs a real account.
--
-- Only INSERT changes. Reading, changing and deleting stay as they were, so an anonymous
-- session that collected something before this rule still sees it, can tidy it, and can
-- carry it across on signing in — the merge path depends on exactly that. What it cannot
-- do is add more.
-- -------------------------------------------------------------------------------------
do $policies$
declare
  t text;
begin
  for t in
    select unnest(array[
      'collection_boxes', 'collection_entries',
      'want_lists', 'want_list_entries'
    ])
  loop
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (user_id = (select auth.uid()) and public.is_real_account())
    $f$, t || '_insert_own', t);
  end loop;
end
$policies$;

-- user_settings is deliberately untouched. It holds display preferences — the chosen
-- currency, the last box filed into — and a visitor adjusting the interface before
-- signing up is not building anything that can be lost.
