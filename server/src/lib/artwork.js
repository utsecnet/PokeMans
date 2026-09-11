/**
 * Rewrites image URLs to the copies the app serves itself.
 *
 * Both Pokédex image sets are vendored into client/public by sync/vendorSprites.mjs: the 96px
 * sprites a table row draws, and the 475px official artwork a grid tile and the detail page
 * draw. Both come from the same PokéAPI sprite repository, which says "you can just download
 * the entire contents directly", and the API's fair-use policy asks callers to cache rather
 * than fetch per view.
 *
 * Rewriting here rather than in the database means a resync can restore the upstream URL
 * without breaking anything, and the vendored copy is preferred the moment it exists.
 *
 * Nothing Pokédex-side is left pointing outward. A URL that is not one we hold locally becomes
 * null rather than passing through, because null is a value every consumer already handles and
 * a remote URL is a value they render — so the failure mode is a missing image, which is
 * visible, rather than a silent fetch from another host, which is not.
 *
 * Card art is a separate pipeline and is untouched by this module.
 */

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
