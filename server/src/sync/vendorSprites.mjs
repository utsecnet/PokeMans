/**
 * Downloads the Pokédex images into the app so they ship with it and nothing is fetched from
 * another host at display time.
 *
 *   node server/src/sync/vendorSprites.mjs
 *
 * PokéAPI is the one artwork source that actively asks for this. Its sprite repository says
 * "you can just download the entire contents directly", and the API's fair-use policy asks
 * callers to "locally cache resources whenever you request them" — hitting raw.githubusercontent
 * .com once per Pokémon per view is exactly what it asks you not to do. Both sets come from
 * that one repository; only the path differs, so the same permission covers both.
 *
 * Both sizes are vendored, because both are displayed. The 96px sprites suit a table row; the
 * 475px official artwork is what a grid tile and the detail page draw. Serving the small one
 * into a large tile is not a substitute — it is visibly worse — so the size is carried.
 *
 * The artwork is re-encoded to AVIF on the way in, which is where the size becomes carryable:
 * 133 MB of PNG measures about 15 MB at quality 65, against a 200 MB Android base module.
 *
 * AVIF rather than WebP because it is not a trade here. Measured against the originals as
 * displayed — composited on the tile background, since RGB under a transparent pixel is
 * undefined and every lossy codec discards it — AVIF q65 scores 42.3 dB where WebP q90 scores
 * 42.1, at 40% of the size. Both are past the point of visible difference; one is smaller.
 *
 * What AVIF does cost is decode time, paid on every grid scroll rather than once at build. If
 * a mid-range phone struggles with 25 tiles at once, WebP q90 is the fallback to go back to.
 *
 * The sprites are lossless WebP, which is a different answer from the artwork above and worth
 * saying why. Measured across 40 real sprites: PNG 0.92 MB, lossless WebP 0.75 MB, lossless
 * AVIF 2.85 MB. AVIF wins on a 475px render and loses badly on a 96px one — its container
 * overhead alone is larger than the pixels — so the format that halved the artwork would have
 * tripled this. Lossless rather than quality 80 because these are pixel art, where a lossy
 * encoder spends its budget blurring the exact edges that carry the image.
 *
 * 153 of the 1,079 are smaller as PNG than as WebP. They are converted anyway: it costs 7.3 KB
 * across the set and buys one extension, which is the difference between the server swapping
 * a suffix and the server having to know which of two formats each sprite happens to be in.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { all } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', '..', '..', 'client', 'public');

/**
 * Each set is named for the directory it lands in, which is also the path the server rewrites
 * URLs to in lib/artwork.js. Keep the two in step — including the extension, which changes
 * when a set is re-encoded: a set added here needs a rewrite there, or the download happens
 * and nothing reads it.
 */
const SETS = [
  {
    dir: 'sprites',
    column: 'sprite_url',
    ext: '.webp',
    encode: (buf) => sharp(buf).webp({ lossless: true, effort: 6 }).toBuffer(),
  },
  {
    dir: 'artwork',
    column: 'artwork_url',
    ext: '.avif',
    encode: (buf) => sharp(buf).avif({ quality: 65, effort: 4 }).toBuffer(),
  },
];

const CONCURRENCY = 8;

async function vendor({ dir, column, ext, encode }) {
  const rows = all(
    `SELECT ${column} AS url FROM pokemon
     WHERE ${column} IS NOT NULL ORDER BY national_dex_number`,
  );
  const out = path.join(PUBLIC, dir);
  mkdirSync(out, { recursive: true });

  let next = 0;
  let written = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        // The file is named for the image's own number in the URL, not our row id, so a
        // re-run after a resync lands on the same names.
        const base = path.basename(new URL(row.url).pathname, path.extname(row.url));
        const dest = path.join(out, base + ext);
        if (existsSync(dest) && statSync(dest).size > 0) {
          skipped++;
          bytes += statSync(dest).size;
          continue;
        }
        try {
          const res = await fetch(row.url);
          if (!res.ok) {
            failed++;
            continue;
          }
          let buf = Buffer.from(await res.arrayBuffer());
          if (encode) buf = await encode(buf);
          writeFileSync(dest, buf);
          bytes += buf.length;
          written++;
        } catch {
          failed++;
        }
      }
    }),
  );

  console.log(
    `${dir}: ${written} downloaded, ${skipped} already present, ${failed} failed — ${(bytes / 1048576).toFixed(2)} MB in ${path.relative(process.cwd(), out)}`,
  );
  return failed;
}

async function main() {
  let failed = 0;
  for (const set of SETS) failed += await vendor(set);
  // A partial vendor is worse than an obvious failure: the views fall back to nothing, and the
  // gap only shows up on whichever Pokémon happened to fail.
  if (failed > 0) process.exitCode = 1;
}

main();
