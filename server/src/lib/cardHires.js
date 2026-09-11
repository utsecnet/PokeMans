/**
 * Fetches a single card's full-size art on demand, converts it, and keeps it.
 *
 * The lightbox opens on the 245px copy that ships with the app, then asks for this in the
 * background and swaps when it arrives. Every later open of that card reads the cached file.
 *
 * Why on demand rather than vendored like everything else: the full-size set is 1.31 GB across
 * 20,444 cards, which cannot ship and is not worth downloading for cards nobody opens. A real
 * user touches a few hundred, which is 10-25 MB — the "cache on view" shape the architecture
 * doc settled on, with the difference that the floor is a local thumbnail rather than nothing.
 * Offline, an uncached card simply stays at 245px instead of failing.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { get } from '../db/index.js';
import { safeFileName } from './artwork.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'client', 'public', 'cards-hi');

/**
 * Quality 80, against the 65 used for the shipped thumbnails.
 *
 * That set is drawn at 129px and its size is multiplied by 20,444; this one fills the card
 * view and costs ~114 KB for exactly the cards someone chose to look at. The cheap axis to
 * spend on is the one the user is staring at.
 */
const QUALITY = 80;

/**
 * In-flight fetches, keyed by card id.
 *
 * Opening the same card twice quickly — or two viewers on one server — would otherwise start
 * two downloads of the same 800 KB PNG and race to write the same file.
 */
const inFlight = new Map();

/** Where this card's full-size art can be had, best source first. */
function sourcesFor(id) {
  const row = get('SELECT image_large AS large, image_webp AS webp FROM tcg_cards WHERE id = @id', { id });
  if (!row) return null;
  return [
    row.large,
    // TCGdex serves a 600x825 under /high.webp for anything it has a /low.webp for, which
    // covers cards whose image_large is missing or points somewhere long dead.
    row.webp ? row.webp.replace('/low.webp', '/high.webp') : null,
  ].filter(Boolean);
}

async function fetchAndConvert(id) {
  const dest = path.join(OUT, `${safeFileName(id)}.avif`);
  if (existsSync(dest) && statSync(dest).size > 0) {
    return `/cards-hi/${safeFileName(id)}.avif`;
  }

  const sources = sourcesFor(id);
  if (sources === null) return null;

  mkdirSync(OUT, { recursive: true });
  for (const url of sources) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = await sharp(Buffer.from(await res.arrayBuffer())).avif({ quality: QUALITY, effort: 4 }).toBuffer();
      writeFileSync(dest, buf);
      return `/cards-hi/${safeFileName(id)}.avif`;
    } catch {
      // Offline, or this source is gone. Try the next; an exhausted list leaves the card on
      // its thumbnail, which is a working outcome rather than an error to show anyone.
    }
  }
  return null;
}

/**
 * The cached path for this card's full-size art, fetching it first if necessary.
 *
 * Resolves to null when no source could be reached — the caller's job is then to do nothing,
 * because the view is already showing something valid.
 */
export function ensureCardHires(id) {
  const existing = inFlight.get(id);
  if (existing) return existing;
  const work = fetchAndConvert(id).finally(() => inFlight.delete(id));
  inFlight.set(id, work);
  return work;
}
