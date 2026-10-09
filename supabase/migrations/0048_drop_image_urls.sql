-- Drop the three card image URL columns.
--
-- Nothing reads them: the five functions that used to send them now send null and let the
-- client name the file from the card id, which is how every image on the site has actually
-- been found since the artwork was vendored onto the device. Nothing writes them either --
-- the two catalogue jobs stopped in the same change.
--
-- Verified before dropping rather than after: the Pokémon page loaded 20 card images, none
-- broken, none pointing at pokemontcg.io or tcgdex.net, and collection_box and want_list
-- both return imageSmall as null with the key still present.
--
-- tcgdex_id stays. It lives on the same table and was once derived from image_webp -- the
-- id was read back out of the URL -- which meant a card losing its artwork upstream also
-- silently withdrew from price capture. Separating them fixed that, and is why price
-- capture is unaffected by this.
alter table public.tcg_cards
  drop column if exists image_small,
  drop column if exists image_large,
  drop column if exists image_webp;
