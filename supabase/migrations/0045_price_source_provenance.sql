-- Where a price actually came from, recorded beside whose price it is.
--
-- The chart says "TCGplayer" because that is whose market the numbers describe: TCGplayer
-- computes the market, low, mid and high, and the figures are theirs. But we do not fetch
-- them from TCGplayer, whose API needs a key we do not have. We fetch from tcgcsv.com, which
-- republishes TCGplayer's daily export for free.
--
-- That courier was recorded nowhere a person could see it -- nine files on the backend and
-- none in the app. It matters because the chain has a failure mode the label hides: if the
-- mirror lags a day, stops updating or drops a group, the chart still says "TCGplayer" with
-- no hedge, and nothing on screen distinguishes TCGplayer's view from a stale copy of it.
--
-- Kept as data rather than prose in a component so that changing feed -- back to tcgcsv's
-- own archive, or to a paid TCGplayer key -- is a row, not a deploy.
alter table public.price_source
  add column if not exists feed_label text,
  add column if not exists feed_url   text,
  add column if not exists feed_note  text;

update public.price_source set
  feed_label = 'tcgcsv.com',
  feed_url   = 'https://tcgcsv.com/tcgplayer/3',
  feed_note  = 'Republishes TCGplayer''s daily price export. Near Mint only; the marketplace '
            || 'also lists played copies, which are cheaper and are not what these figures '
            || 'describe. One fetch per set per day, which is what they ask for.'
where key = 'tcgplayer';

comment on column public.price_source.label is
  'Whose prices these are -- the marketplace whose market the figures describe.';
comment on column public.price_source.feed_label is
  'Where we fetch them from, which is not always the same party as the one that priced them.';
