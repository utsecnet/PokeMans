-- Report the first date held, whatever window was asked for.
--
-- The chart fetches the range it is showing, so the stride matches that range: ask for
-- seven days and you get seven daily points, not every third day of the whole history
-- sampled down. That was the flaw in striding a single full-depth read -- the last week is
-- kept daily by the retention policy and the chart was throwing two thirds of it away.
--
-- But a windowed read cannot see how far the record goes back, and the caption under the
-- chart says "recorded since". So the first date is reported separately, from the table
-- rather than from the window.
create or replace function public.card_first_priced(p_card_id text)
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select min(captured_on) from public.price_point where card_id = p_card_id;
$$;

grant execute on function public.card_first_priced(text) to authenticated, service_role;
