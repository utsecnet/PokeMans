/**
 * Downloads the set symbols, set logos and series logos into the app.
 *
 * The smallest of the image sets and the last one still pointing outward: 174 set symbols and
 * 174 set logos from images.pokemontcg.io, and 15 series logos from assets.tcgdex.net. A few
 * megabytes all told, against 367 MB of card art and 17 MB of Pokédex images.
 *
 * Unlike the other two sets this one is a button on the settings page rather than a script,
 * because it is small enough to run on demand and because it is the piece most likely to
 * change: sets arrive several times a year, and each new one brings a symbol and a logo that
 * a fresh sync should pick up without anyone running a command.
 *
 * Encoded at quality 80 rather than the 65 used for card art. These are flat graphics with
 * hard edges and text — the failure mode of a low quality setting on a symbol rendered at
 * 16px is mush, and at this total size there is nothing to be gained by pushing it.
 */
import { mkdirSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { all } from '../db/index.js';
import { refreshLogoCache, safeFileName } from '../lib/artwork.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', '..', '..', 'client', 'public', 'logos');

// Low: this is a few hundred small files and the encode is cheap, so there is nothing to win
// by competing with the rest of the machine for memory.
const CONCURRENCY = 4;

/** Every logo the catalogue knows about, as { name, url } pairs keyed for the filesystem. */
function logoTargets() {
  const targets = [];
  for (const s of all('SELECT id, symbol_url AS symbolUrl, logo_url AS logoUrl FROM tcg_sets')) {
    if (s.symbolUrl) targets.push({ name: `set-${safeFileName(s.id)}-symbol`, url: s.symbolUrl });
    if (s.logoUrl) targets.push({ name: `set-${safeFileName(s.id)}-logo`, url: s.logoUrl });
  }
  // Series have no id of their own — the name is the key, in the schema and here.
  for (const s of all('SELECT name, logo_url AS logoUrl FROM tcg_series')) {
    if (s.logoUrl) targets.push({ name: `series-${safeFileName(s.name)}`, url: s.logoUrl });
  }
  return targets;
}

export async function syncLogos({ onProgress } = {}) {
  const targets = logoTargets();
  mkdirSync(OUT, { recursive: true });

  let next = 0;
  let written = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
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
    }),
  );

  // The resolver caches a directory listing; this run is exactly what makes it wrong.
  refreshLogoCache();

  return { total: targets.length, written, skipped, failed, bytes };
}

/**
 * What the settings page shows next to the button: how many of the logos the catalogue knows
 * about are actually on disk. Counting targets rather than files means a set added by a
 * catalogue sync shows up immediately as a shortfall.
 */
export function logoStats() {
  const total = logoTargets().length;
  let stored = 0;
  try {
    stored = readdirSync(OUT).filter((f) => f.endsWith('.avif')).length;
  } catch {
    stored = 0;
  }
  return { total, stored };
}
