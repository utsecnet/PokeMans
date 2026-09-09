/**
 * Rewrites artwork URLs to whatever the app can serve locally.
 *
 * Sprites are vendored into client/public/sprites by sync/vendorSprites.mjs — about 1 MB for
 * all 1,079, which is nothing next to a 200 MB base module, and PokéAPI's own fair-use policy
 * asks callers to cache rather than fetch per view. Rewriting here rather than in the database
 * means a resync can restore the upstream URL without breaking anything, and the vendored copy
 * is still preferred the moment it exists.
 *
 * Everything else is left alone. Official artwork averages 143 KB and totals 151 MB across the
 * Pokédex, and card art is 458 MB at the smallest usable size, so neither ships — those are
 * cached on view instead, on the device.
 */

/** e.g. .../sprites/pokemon/25.png and .../sprites/pokemon/other/official-artwork/25.png */
const SPRITE_HOST = /^https?:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\//i;

/**
 * The local path for a vendored sprite, or the original URL when it is not one we hold.
 *
 * Only the flat sprite directory is vendored; the nested ones (official artwork, home,
 * showdown) are far larger and stay remote, so a URL with any extra path segment falls
 * through untouched.
 */
export function localSprite(url) {
  if (!url || !SPRITE_HOST.test(url)) return url ?? null;
  const match = /\/sprites\/pokemon\/(\d+\.png)$/i.exec(url);
  return match ? `/sprites/${match[1]}` : url;
}

/** Applies localSprite to the spriteUrl of every row in a result set, in place. */
export function localiseSprites(rows) {
  for (const row of rows) {
    if (row && typeof row === 'object' && 'spriteUrl' in row) {
      row.spriteUrl = localSprite(row.spriteUrl);
    }
  }
  return rows;
}
