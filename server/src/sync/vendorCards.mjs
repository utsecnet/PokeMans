/**
 * Downloads the trading card art into the app.
 *
 *   node server/src/sync/vendorCards.mjs
 *
 * Separate from vendorSprites.mjs because the trade-offs are not the same. The Pokédex sets are
 * small enough to ship without thinking about it; this one is 20,444 images and lands near
 * 310 MB, which is larger than Play's 200 MB base module allows. It is vendored so the app can
 * serve it locally, but where it ends up shipping — asset pack, on-demand, or cached per device
 * — is a delivery question this script does not answer.
 *
 * Source is TCGdex's `low` render, 245x337, which is what the card grid draws at 129px. Measured
 * against the alternatives:
 *
 *   TCGdex low, kept as WebP          18.4 KB each    360 MB
 *   TCGdex low, re-encoded to AVIF    15.9 KB each    310 MB
 *   pokemontcg.io PNG -> AVIF         16.7 KB each    330 MB, but 3.13 GB to download
 *   TCGdex high (600x825) -> AVIF     67.0 KB each    1.31 GB
 *
 * AVIF earns only 14% here, against 40% on the Pokédex artwork, because the TCGdex source is
 * already lossy WebP — the encoder spends its budget preserving someone else's compression
 * artifacts rather than compressing clean data. Going to the PNG original to avoid that costs
 * 3.13 GB of downloads to save nothing, so it is not worth it: the 14% is taken and the source
 * stays TCGdex.
 *
 * 1,033 cards have no TCGdex render and fall back to pokemontcg.io's PNG, which is the same
 * 245px class of image.
 */
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { all } from '../db/index.js';

/**
 * Hand-mapped art for the 50 cards no API serves.
 *
 * Four McDonald's promo sets, a HeartGold/SoulSilver promo and a Scarlet & Violet promo: the
 * catalogue lists image URLs for all of them, and every one 404s at both TCGdex and
 * pokemontcg.io. pokellector has them, so these are resolved by hand and recorded here rather
 * than left as a gap a future re-vendor would silently reopen.
 *
 * Sources are full-size renders (~570x795), downscaled like everything else. Note that
 * pokellector files svp-102 under the name Offish; it is Oddish, verified by eye.
 */
const FALLBACK = JSON.parse(readFileSync(new URL('./cardArtFallback.json', import.meta.url), 'utf8'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', '..', '..', 'client', 'public', 'cards');

/**
 * Deliberately low, and paired with the two sharp limits below.
 *
 * AVIF encoding is memory-hungry: libvips holds an operation cache and its own thread pool per
 * encode, so eight in flight was enough to get this killed by the OS on a machine also running
 * an emulator and a browser. Three encodes with the cache off and one libvips thread each is
 * slower per image but survives, which is the only speed that matters for a 20,444-image run.
 */
const CONCURRENCY = 3;

sharp.cache(false);
sharp.concurrency(1);

/**
 * A card id as a filename.
 *
 * Two real ids are Unown "!" and Unown "?" — and "?" cannot be a filename on Windows at all.
 * Escaping only the offending characters would map both onto the same name, so the escape has
 * to be injective: "_" is itself escaped, which means no unescaped id can collide with an
 * escaped one. lib/artwork.js applies the same function, and main() asserts the result is
 * still unique across the whole catalogue.
 */
export function cardFileName(id) {
  return id.replace(/[^a-zA-Z0-9.-]/g, (c) => '_' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

async function main() {
  const rows = all(
    `SELECT id, image_webp AS webp, image_small AS png FROM tcg_cards
     WHERE image_webp IS NOT NULL OR image_small IS NOT NULL ORDER BY id`,
  );

  // Fail before 20,444 downloads rather than after, if the escape ever stops being injective.
  const names = new Set(rows.map((r) => cardFileName(r.id)));
  if (names.size !== rows.length) {
    console.error(`filename collision: ${rows.length} cards map to ${names.size} names`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(OUT, { recursive: true });

  let next = 0;
  let written = 0;
  let skipped = 0;
  let failed = 0;
  let fallback = 0;
  let bytes = 0;
  let lastLog = Date.now();

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        const dest = path.join(OUT, cardFileName(row.id) + '.avif');
        if (existsSync(dest) && statSync(dest).size > 0) {
          skipped++;
          bytes += statSync(dest).size;
          continue;
        }
        // Fall back on the *response*, not on the row. TCGdex 404s for 751 real cards —
        // whole swathes of swsh7/8/9 and the XY promos — while listing a URL for them all the
        // same, and pokemontcg.io serves every one of those. Choosing the source up front and
        // only falling back when image_webp was NULL left those 751 with no art at all.
        const candidates = [row.webp, row.png, FALLBACK[row.id]].filter(Boolean);
        let done = false;
        for (const [i, url] of candidates.entries()) {
          try {
            const res = await fetch(url);
            if (!res.ok) continue;
            // Resize explicitly rather than trusting the source. The three sources disagree:
            // TCGdex is 245x337, pokemontcg.io 245x342, and the pokellector fallbacks are
            // full-size 570x795. 'cover' keeps one grid geometry without stretching art —
            // pokellector's files carry the true 63x88mm card ratio, so it trims a sliver of
            // border rather than distorting the card.
            const buf = await sharp(Buffer.from(await res.arrayBuffer()))
              .resize(245, 337, { fit: 'cover' })
              .avif({ quality: 65, effort: 4 })
              .toBuffer();
            writeFileSync(dest, buf);
            bytes += buf.length;
            written++;
            if (i > 0 || !row.webp) fallback++;
            done = true;
            break;
          } catch {
            // Try the next source; only an exhausted list counts as a failure.
          }
        }
        if (!done) failed++;
        if (Date.now() - lastLog > 20000) {
          lastLog = Date.now();
          console.log(`  ${written + skipped}/${rows.length} — ${(bytes / 1048576).toFixed(0)} MB`);
        }
      }
    }),
  );

  console.log(
    `cards: ${written} downloaded (${fallback} via pokemontcg.io fallback), ${skipped} already present, ${failed} failed — ${(bytes / 1048576).toFixed(1)} MB in ${path.relative(process.cwd(), OUT)}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main();
