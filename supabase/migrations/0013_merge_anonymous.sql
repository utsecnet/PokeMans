-- =====================================================================================
-- PokéMans — bringing an anonymous session's things with you when you sign in
--
-- Someone browses, builds a collection, then signs in with a Google account that already
-- exists here. Their two accounts cannot be linked — the Google identity is taken — so
-- the only honest options were to abandon what they built or refuse the sign-in. Both are
-- bad answers to a situation the app created.
--
-- This moves the rows instead.
--
-- Run in the Supabase SQL editor, or via `supabase db push`. Idempotent.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- Let a box change hands without its cards objecting.
--
-- The composite foreign keys carry `on delete cascade` but not `on update`, so
-- reassigning a box's user_id broke the link to its own entries — there is no ordering
-- that avoids it, because parent and child have to change together. `on update cascade`
-- makes the children follow, which turns the whole merge into one UPDATE per table.
-- -------------------------------------------------------------------------------------
alter table public.collection_entries
  drop constraint if exists collection_entries_box_same_user;
alter table public.collection_entries
  add constraint collection_entries_box_same_user
    foreign key (box_id, user_id)
      references public.collection_boxes (id, user_id)
      on delete cascade on update cascade;

alter table public.want_list_entries
  drop constraint if exists want_list_entries_list_same_user;
alter table public.want_list_entries
  add constraint want_list_entries_list_same_user
    foreign key (list_id, user_id)
      references public.want_lists (id, user_id)
      on delete cascade on update cascade;

-- -------------------------------------------------------------------------------------
-- merge_anonymous_account — hand everything from a throwaway account to a real one.
--
-- `security definer`, and granted to service_role alone. It writes rows belonging to two
-- different users, which no policy allows and no user should be able to ask for directly:
-- a function callable by `authenticated` that moved another account's rows on request
-- would be a way to steal a collection by naming its owner.
--
-- The Edge Function that calls this is what establishes the right to: it verifies an
-- access token for each side before asking, so the caller has proved it holds both
-- sessions. This function trusts that, and checks what it still can — that the source is
-- genuinely an anonymous account, so a real one can never be emptied this way.
-- -------------------------------------------------------------------------------------
create or replace function public.merge_anonymous_account(p_from uuid, p_to uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_anon boolean;
  v_boxes   integer;
  v_lists   integer;
  v_cards   integer;
  v_wanted  integer;
begin
  if p_from = p_to then
    return json_build_object('moved', false, 'reason', 'same account');
  end if;

  select coalesce(is_anonymous, false) into v_is_anon from auth.users where id = p_from;
  if not coalesce(v_is_anon, false) then
    -- Refusing this is the whole safety property. Without it, the function would move one
    -- real account's collection into another on request.
    raise exception 'refusing to merge from a non-anonymous account';
  end if;
  if not exists (select 1 from auth.users where id = p_to) then
    raise exception 'target account does not exist';
  end if;

  -- Names are unique per user, so anything the target already uses has to give way before
  -- the move, not after — the constraint fires on the UPDATE itself. The suffix says
  -- where it came from rather than pretending the clash did not happen.
  update public.collection_boxes b
     set name = b.name || ' (from this browser)'
   where b.user_id = p_from
     and exists (select 1 from public.collection_boxes t
                  where t.user_id = p_to and t.name = b.name);

  update public.want_lists l
     set name = l.name || ' (from this browser)'
   where l.user_id = p_from
     and exists (select 1 from public.want_lists t
                  where t.user_id = p_to and t.name = l.name);

  select count(*) into v_cards  from public.collection_entries where user_id = p_from;
  select count(*) into v_wanted from public.want_list_entries  where user_id = p_from;

  -- Entries follow their parent, by the cascade added above.
  with moved as (
    update public.collection_boxes set user_id = p_to where user_id = p_from returning 1
  ) select count(*) into v_boxes from moved;

  with moved as (
    update public.want_lists set user_id = p_to where user_id = p_from returning 1
  ) select count(*) into v_lists from moved;

  -- Settings are not moved. They are preferences, the target account already has its own,
  -- and silently overwriting someone's chosen currency with a throwaway session's default
  -- would be a worse surprise than leaving them alone.

  -- The anonymous account has nothing left. Deleting it keeps auth.users from filling
  -- with husks, and anything still pointing at it would cascade anyway.
  delete from auth.users where id = p_from;

  return json_build_object(
    'moved', true,
    'boxes', v_boxes, 'cards', v_cards,
    'lists', v_lists, 'wanted', v_wanted
  );
end;
$$;

revoke all on function public.merge_anonymous_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_anonymous_account(uuid, uuid) to service_role;
