-- Say which condition the figure is for.
--
-- TCGplayer publishes a market price per condition and what we store is the Near Mint one.
-- Their own product page lands on the cheapest listing instead, which for Base Set
-- Charizard is a Damaged copy at $181 against the $928 we show -- same source, same day,
-- different condition. Anyone comparing the two concludes our prices are wrong, and the
-- only thing missing is the word.
alter table public.price_source
  add column if not exists price_basis text not null default 'Near Mint';

update public.price_source set price_basis = 'Near Mint' where key = 'tcgplayer';
