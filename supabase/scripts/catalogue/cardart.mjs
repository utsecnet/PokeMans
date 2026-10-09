/**
 * Downloads every card's artwork and re-encodes it, so nothing is fetched from another site
 * while someone is using the app.
 *
 *   node supabase/scripts/catalogue/cardart.mjs                  everything missing
 *   node supabase/scripts/catalogue/cardart.mjs --owned          only cards you hold or want
 *   node supabase/scripts/catalogue/cardart.mjs --set base1      one set
 *   node supabase/scripts/catalogue/cardart.mjs --redo           re-encode what is already here
 *
 * Two sizes per card, both cut from the same download: a 245px thumbnail for the grid and
 * the full 600x825 for the lightbox, which fades in over the thumbnail once it has loaded.
 *
 * The lightbox upgrade used to work by asking the Express server to fetch one card on
 * demand, and that went when the server did -- which is why 28 cards had a full-size copy
 * and twenty thousand did not. Fetching at view time is also the thing we are trying not to
 * do: a self-hosted app should not reach out to a third party because someone opened a card.
 * So every file is here before anyone looks.
 *
 * ENCODING. Measured on a real holo card rather than guessed:
 *
 *     full size   q80 121 KB   q65 78 KB   q60 68 KB   q55 53 KB
 *     thumbnail   q65 18.6 KB  q60 16.6 KB  q55 13.8 KB  q50 12.1 KB
 *
 * q60 full and q55 thumbnail. Compared at 1:1 against the source png, the differences live
 * almost entirely in the holo foil's film grain, which is noise rather than detail -- the
 * linework, text and colour are indistinguishable. The old files were encoded at about q80
 * and are 44% larger for grain nobody is looking at.
 *
 * About 1.6 GB for the whole catalogue. That is the price of not calling out at view time.
 */
import { mkdirSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { selectAll } from './_db.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) {
    console.error(`   ${name} needs a value.`);
    process.exit(2);
  }
  return v;
};

const OWNED_ONLY = args.includes('--owned');
const REDO = args.includes('--redo');
const ONE_SET = flag('--set');

const PUBLIC = path.join(process.cwd(), 'client', 'public');
const THUMBS = path.join(PUBLIC, 'cards');
const FULL = path.join(PUBLIC, 'cards-hi');

const THUMB_WIDTH = 245;
const THUMB_QUALITY = 55;

// The lightbox draws the card at 408x561 on a 1953px window, and upstream serves anything
// from 600 to 734 wide depending on the card. 700 covers that display at better than
// 1.7x -- room for a sharper screen -- without storing pixels nobody will see, and never
// enlarges a card that arrives smaller.
const FULL_MAX_WIDTH = 700;
const FULL_QUALITY = 60;
const EFFORT = 6;          // sharp's scale is 0-9; 6 is most of the gain, well short of the cost

// Four at a time. The encode is the slow half and it is CPU-bound, so this mostly keeps the
// downloads overlapping while a core is busy; more than this and the machine stops being
// usable for anything else.
const CONCURRENCY = 4;

/** Mirrors the client's own rule, so a name written here resolves there. */
const safeFileName = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '');

/**
 * Where the artwork lives upstream.
 *
 * Built from the set and the card number rather than read from a column. The URLs used to
 * be stored on tcg_cards and were dropped once nothing rendered them -- the client names
 * every image from the card id -- and this is the one place that still needs the upstream
 * address, so it derives it rather than keeping three columns alive for one script.
 */
const sourceUrl = (card, hires) =>
  `https://images.pokemontcg.io/${card.set_id}/${card.number}${hires ? '_hires' : ''}.png`;

async function main() {
  const cards = await selectAll('tcg_cards', 'id,set_id,number',
    (q) => (ONE_SET ? q.eq('set_id', ONE_SET) : q));
  if (!cards.length) {
    console.error(ONE_SET ? `   no cards in set ${ONE_SET}.` : '   no cards in the catalogue.');
    process.exit(2);
  }

  let wanted = cards;
  if (OWNED_ONLY) {
    const held = await selectAll('collection_entries', 'card_id');
    const listed = await selectAll('want_list_entries', 'card_id');
    const ids = new Set([...held, ...listed].map((r) => r.card_id));
    wanted = cards.filter((c) => ids.has(c.id));
    console.log(`   ${wanted.length} of ${cards.length} cards are in a collection or want list`);
  }

  mkdirSync(THUMBS, { recursive: true });
  mkdirSync(FULL, { recursive: true });

  const todo = wanted.filter((c) => {
    if (REDO) return true;
    const name = `${safeFileName(c.id)}.avif`;
    const haveThumb = existsSync(path.join(THUMBS, name)) && statSync(path.join(THUMBS, name)).size > 0;
    const haveFull = existsSync(path.join(FULL, name)) && statSync(path.join(FULL, name)).size > 0;
    return !(haveThumb && haveFull);
  });

  console.log(`   ${todo.length.toLocaleString()} cards to fetch, ${(wanted.length - todo.length).toLocaleString()} already held`);
  if (!todo.length) {
    console.log('   nothing to do.');
    return;
  }

  let next = 0;
  let done = 0;
  let written = 0;
  let failed = 0;
  let bytes = 0;
  const missing = [];

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < todo.length) {
      const card = todo[next++];
      const name = `${safeFileName(card.id)}.avif`;
      try {
        // One download, both sizes. Asking for the thumbnail separately would double the
        // requests on a run that already makes twenty thousand.
        let res = await fetch(sourceUrl(card, true));
        // A handful of cards have no _hires on the CDN; the plain one still beats nothing.
        if (!res.ok) res = await fetch(sourceUrl(card, false));
        if (!res.ok) { failed++; missing.push(card.id); continue; }
        const source = Buffer.from(await res.arrayBuffer());

        const full = await sharp(source)
          .resize({ width: FULL_MAX_WIDTH, withoutEnlargement: true })
          .avif({ quality: FULL_QUALITY, effort: EFFORT })
          .toBuffer();
        const thumb = await sharp(source)
          .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
          .avif({ quality: THUMB_QUALITY, effort: EFFORT })
          .toBuffer();

        writeFileSync(path.join(FULL, name), full);
        writeFileSync(path.join(THUMBS, name), thumb);
        bytes += full.length + thumb.length;
        written++;
      } catch {
        failed++;
        missing.push(card.id);
      }
      if (++done % 200 === 0 || done === todo.length) {
        process.stdout.write(`\r      ${done.toLocaleString()} of ${todo.length.toLocaleString()}  ·  ${(bytes / 1048576).toFixed(0)} MB written  `);
      }
    }
  }));

  process.stdout.write('\r');
  console.log(`   ${written.toLocaleString()} cards written, ${(bytes / 1048576).toFixed(0)} MB`);
  if (failed) {
    console.log(`   ${failed} had no artwork upstream${missing.length <= 10 ? `: ${missing.join(', ')}` : ''}`);
  }
  const onDisk = (d) => readdirSync(d).filter((f) => f.endsWith('.avif')).length;
  console.log(`   on disk now: ${onDisk(THUMBS).toLocaleString()} thumbnails, ${onDisk(FULL).toLocaleString()} full size`);
}

await main();
