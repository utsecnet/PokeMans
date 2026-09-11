/**
 * Rewrites image URLs to the copies the app serves itself, so nothing is fetched from another
 * host at display time.
 *
 * Three vendored sets, written by two scripts in sync/:
 *
 *   client/public/sprites   96px Pokédex sprites, PNG          1,079 files     1 MB
 *   client/public/artwork   475px official artwork, AVIF       1,079 files    16 MB
 *   client/public/cards     245px trading card art, AVIF      20,394 files   317 MB
 *
 * The first two are committed; the cards are not, because 317 MB is permanent once it is in
 * git history and cannot ship in a 200 MB base module regardless.
 *
 * A URL that is not one we hold locally becomes null rather than passing through, because null
 * is a value every consumer already handles and a remote URL is a value they render — so the
 * failure mode is a missing image, which is visible, rather than a silent fetch from another
 * host, which is not.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CARD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'client', 'public', 'cards');

/** e.g. .../sprites/pokemon/25.png and .../sprites/pokemon/other/official-artwork/25.png */
const SPRITE_HOST = /^https?:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\//i;

/**
 * The local path for a vendored 96px sprite, or null.
 *
 * Matches only the flat sprite directory — a nested path is some other set (official artwork,
 * home, showdown) and is not what this serves.
 */
export function localSprite(url) {
  if (!url || !SPRITE_HOST.test(url)) return null;
  const match = /\/sprites\/pokemon\/(\d+\.png)$/i.exec(url);
  return match ? `/sprites/${match[1]}` : null;
}

/**
 * The local path for a vendored 475px official artwork render, or null.
 *
 * The extension changes on the way through: upstream is PNG, the vendored copy is AVIF at
 * quality 65, which takes the set from 133 MB to 15 MB. Keeping the swap here leaves this
 * module the only place that has to know what is actually on disk.
 */
export function localArtwork(url) {
  if (!url || !SPRITE_HOST.test(url)) return null;
  const match = /\/other\/official-artwork\/(\d+)\.png$/i.exec(url);
  return match ? `/artwork/${match[1]}.avif` : null;
}

/** Applies both rewrites to every row in a result set, in place. */
export function localiseSprites(rows) {
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if ('spriteUrl' in row) row.spriteUrl = localSprite(row.spriteUrl);
    if ('artworkUrl' in row) row.artworkUrl = localArtwork(row.artworkUrl);
  }
  return rows;
}

/**
 * A card id as the filename vendorCards.mjs wrote.
 *
 * Two real ids are Unown "!" and Unown "?", and "?" cannot be a filename on Windows at all.
 * Escaping only the offending characters would map both onto the same name, so the escape is
 * injective: "_" is itself escaped, which means no unescaped id can collide with an escaped
 * one. vendorCards.mjs exports the same function and asserts uniqueness across the catalogue.
 */
export function cardFileName(id) {
  return id.replace(/[^a-zA-Z0-9.-]/g, (c) => '_' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

/**
 * Which cards we actually hold art for, read once.
 *
 * 50 cards have no art at any source — four McDonald's promo sets and two Black Star promos,
 * where the catalogue lists URLs that neither TCGdex nor pokemontcg.io serves. Pointing those
 * at a local path would turn a card that renders nothing into a card that renders a broken
 * image, so they resolve to null and the existing `imageSmall &&` guards hide them as before.
 *
 * One readdir at startup rather than an existsSync per row: this is on the card grid's path,
 * which returns hundreds of rows per request.
 */
let cardFiles = null;
function haveCard(id) {
  if (cardFiles === null) {
    try {
      cardFiles = new Set(readdirSync(CARD_DIR));
    } catch {
      // No vendor run yet. Every lookup misses, card art resolves to null, and the app shows
      // the same blank tiles it shows for the 50 that genuinely have none.
      cardFiles = new Set();
    }
  }
  return cardFiles.has(cardFileName(id) + '.avif');
}

/** The local path for a vendored card image, or null. */
export function localCard(id) {
  return id && haveCard(id) ? `/cards/${cardFileName(id)}.avif` : null;
}

/**
 * Points every card row in a result set at the vendored art, in place.
 *
 * Rows carry the card id as `id` everywhere except collection entries, which call it
 * `cardId`. Both are accepted rather than normalising the routes, which would mean renaming a
 * field the client already reads.
 */
export function localiseCards(rows) {
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !('imageSmall' in row)) continue;
    row.imageSmall = localCard(row.id ?? row.cardId);
  }
  return rows;
}
