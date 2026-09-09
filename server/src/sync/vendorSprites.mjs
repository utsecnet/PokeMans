/**
 * Downloads the Pokédex sprites into the app so they ship with it.
 *
 *   node server/src/sync/vendorSprites.mjs
 *
 * PokéAPI is the one artwork source that actively asks for this. Its sprite repository says
 * "you can just download the entire contents directly", and the API's fair-use policy asks
 * callers to "locally cache resources whenever you request them" — hitting raw.githubusercontent
 * .com once per Pokémon per view is exactly what it asks you not to do.
 *
 * Only the 96px sprites are vendored. Measured, all 1,079 come to about 1 MB, which is free
 * next to a 200 MB base module. The official artwork averages 143 KB and totals 151 MB, so it
 * stays remote and is cached on view like card art.
 *
 * Written to client/public so Vite serves it in development and bundles it into the WebView's
 * assets for the Android build, with no extra plumbing in either.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', '..', '..', 'client', 'public', 'sprites');

const CONCURRENCY = 8;

async function main() {
  const rows = all(
    `SELECT id, national_dex_number AS dex, sprite_url AS url
     FROM pokemon WHERE sprite_url IS NOT NULL ORDER BY national_dex_number`,
  );
  mkdirSync(OUT, { recursive: true });

  let next = 0;
  let written = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        // The file is named for the sprite's own number in the URL, not our row id, so a
        // re-run after a resync lands on the same names.
        const name = `${path.basename(new URL(row.url).pathname)}`;
        const dest = path.join(OUT, name);
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
          const buf = Buffer.from(await res.arrayBuffer());
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
    `sprites: ${written} downloaded, ${skipped} already present, ${failed} failed — ${(bytes / 1048576).toFixed(2)} MB in ${path.relative(process.cwd(), OUT)}`,
  );
}

main();
