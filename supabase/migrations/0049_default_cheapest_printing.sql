-- File a copy as the cheapest printing rather than as no printing at all.
--
-- Adding a card left variant_position null, and the printing had to be chosen by hand
-- afterwards from a select that opened on "Printing not set". Most copies never got one,
-- and an unset copy is unpriced by entry_price -- so a collection of real cards reported a
-- value of nothing and a count of unpriced copies equal to its own size. The number that
-- was meant to be the point of the page was blank for anyone who had not sat and filled in
-- a dropdown per card.
--
-- The cheapest priced printing is the one default that cannot flatter the collection.
-- Every other choice claims the owner holds a better print than the evidence supports; a
-- reverse holo guessed where a plain copy sits inflates the total and nobody asked it to.
-- Guessing low is wrong in the direction that gets corrected, because a collector who sees
-- their Charizard listed at the unlimited price goes and fixes it, while one who sees it
-- listed too high has no reason to.
--
-- This is a default, not a decision. "Printing not set" is still in the select, still
-- means what it said, and a copy set back to it stays that way -- the trigger only fills a
-- null on the way in, and never touches an existing row.

-- ---------------------------------------------------------------- which printing

create or replace function public.cheapest_printing(p_card_id text)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  with printings as (
    select v.position, min(pl.market) as market
    from public.tcg_card_variants v
    join public.tcg_cards c on c.id = v.card_id
    left join public.price_latest pl
      on pl.card_ref = c.ref
     and pl.variant_position = v.position::smallint
     and pl.market is not null
    where v.card_id = p_card_id
    group by v.position
  )
  select position
  from printings
  -- A card whose printings are all unpriced answers with its only printing, or with
  -- nothing. One printing is not a choice, so recording it states a fact; choosing between
  -- several unpriced ones would be inventing one, which is the thing this must not do.
  where market is not null
     or (select count(*) from printings) = 1
  order by market nulls last, position
  limit 1;
$$;

grant execute on function public.cheapest_printing(text) to authenticated, service_role;

-- ---------------------------------------------------------------- on the way in

-- In the database rather than in addToCollection, for two reasons. The client would need a
-- round trip to learn the prices before it could insert, on the one flow in the app built
-- for tapping a card repeatedly; and every other path that files a copy -- the anonymous
-- merge, a future import -- would have to remember to do the same thing.
create or replace function public.collection_entry_default_printing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.variant_position is null then
    new.variant_position := public.cheapest_printing(new.card_id);
  end if;
  return new;
end;
$$;

drop trigger if exists collection_entries_default_printing on public.collection_entries;
create trigger collection_entries_default_printing
  before insert on public.collection_entries
  for each row
  execute function public.collection_entry_default_printing();

-- ---------------------------------------------------------------- what is already filed

-- Copies filed before this migration, which are the ones the change is actually for: they
-- are the collections sitting at a value of zero. Only rows with no printing recorded are
-- touched. A copy somebody took the trouble to name is left exactly as they named it,
-- including where they named something other than the cheapest, which is the whole reason
-- the select exists.
with pick as (
  select e.id, public.cheapest_printing(e.card_id) as position
  from public.collection_entries e
  where e.variant_position is null
)
update public.collection_entries e
   set variant_position = pick.position
  from pick
 where pick.id = e.id
   and pick.position is not null;
