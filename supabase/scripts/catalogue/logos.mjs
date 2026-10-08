/**
 * Downloads the set symbols, set logos and series wordmarks into the app.
 *
 * The smallest of the image sets: 174 set symbols, 174 set logos from images.pokemontcg.io,
 * and 15 series wordmarks from assets.tcgdex.net. A few megabytes all told, against 367 MB of
 * card art and 17 MB of Pokédex images.
 *
 * Only the reading of what to fetch moved to Supabase. The files still land in
 * client/public/logos, which is what "hosting from the laptop as if it were R2" means in
 * practice: the app names an image by a stable path, and where that path is served from is a
 * deployment question rather than an application one.
 *
 * Encoded at quality 80 rather than the 65 used for card art. These are flat graphics with
 * hard edges and text, where the failure mode of a low quality setting on a symbol rendered
 * at 16px is mush, and at this total size there is nothing to be gained by pushing it.
 */
import { mkdirSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { selectAll } from './_db.mjs';

const OUT = path.join(process.cwd(), 'client', 'public', 'logos');

// Low: a few hundred small files whose encode is cheap, so there is nothing to win by
// competing with the rest of the machine for memory.
const CONCURRENCY = 4;

/** Mirrors the client's own rule, so a name built here resolves there. */
const safeFileName = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_');

/** Every logo the catalogue knows about, as name and URL pairs keyed for the filesystem. */
async function logoTargets() {
  const targets = [];
  for (const s of await selectAll('tcg_sets', 'id,symbol_url,logo_url')) {
    if (s.symbol_url) targets.push({ name: `set-${safeFileName(s.id)}-symbol`, url: s.symbol_url });
    if (s.logo_url) targets.push({ name: `set-${safeFileName(s.id)}-logo`, url: s.logo_url });
  }
  // Series have no id of their own -- the name is the key, in the schema and here.
  for (const s of await selectAll('tcg_series', 'name,logo_url')) {
    if (s.logo_url) targets.push({ name: `series-${safeFileName(s.name)}`, url: s.logo_url });
  }
  return targets;
}

export async function syncLogos({ onProgress } = {}) {
  const targets = await logoTargets();
  mkdirSync(OUT, { recursive: true });

  let next = 0;
  let written = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < targets.length) {
      const target = targets[next++];
      const dest = path.join(OUT, `${target.name}.avif`);
      if (existsSync(dest) && statSync(dest).size > 0) {
        skipped++;
        bytes += statSync(dest).size;
        onProgress?.({ done: written + skipped, total: targets.length });
        continue;
      }
      try {
        const res = await fetch(target.url);
        if (!res.ok) {
          failed++;
          continue;
        }
        const buf = await sharp(Buffer.from(await res.arrayBuffer()))
          .avif({ quality: 80, effort: 4 })
          .toBuffer();
        writeFileSync(dest, buf);
        bytes += buf.length;
        written++;
      } catch {
        failed++;
      }
      onProgress?.({ done: written + skipped, total: targets.length });
    }
  }));

  return { total: targets.length, written, skipped, failed, bytes };
}

