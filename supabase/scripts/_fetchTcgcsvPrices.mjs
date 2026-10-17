// Caches one day of tcgcsv's price files, which is how buildPriceMap learns the printing
// names each product actually publishes. The mapping cannot be worked out from the product
// list alone: "Erika's Oddish (Poke Ball)" sells only as Reverse Holofoil, and the only
// place that is written down is the price file.
//
// Laid out as the daily archive is -- <day>/<category>/<group>/prices -- because that is
// what buildPriceMap walks, and the archive is the other way to fill this directory.
//
// Fetched at most once a day, per tcgcsv's etiquette, and skipped entirely if today's
// directory already exists. The daily capture fetches the same files; this is for working
// on the map offline, not a second scheduled reader.
import fs from 'node:fs';
import path from 'node:path';

const UA = { 'User-Agent': 'PokeMans/1.0 (collection tracker; contact rjohnson@utsec.net)' };
const CATEGORY = 3; // Pokemon
const OUT = process.argv[2] || '.';
const day = new Date().toISOString().slice(0, 10);
const dir = path.join(OUT, `d_prices-${day}`, String(CATEGORY));
if (fs.existsSync(dir)) { console.log('   cached already'); process.exit(0); }

const groups = (await (await fetch(`https://tcgcsv.com/tcgplayer/${CATEGORY}/groups`, { headers: UA })).json()).results;
fs.mkdirSync(dir, { recursive: true });

const queue = [...groups];
let done = 0, rows = 0, failed = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const g = queue.pop();
    try {
      const r = await fetch(`https://tcgcsv.com/tcgplayer/${CATEGORY}/${g.groupId}/prices`, { headers: UA });
      if (!r.ok) { failed++; continue; }
      const body = await r.text();
      fs.mkdirSync(path.join(dir, String(g.groupId)), { recursive: true });
      fs.writeFileSync(path.join(dir, String(g.groupId), 'prices'), body);
      rows += (JSON.parse(body).results ?? []).length;
    } catch { failed++; }
    if (++done % 50 === 0) console.log(`   ${done}/${groups.length}`);
  }
}));
console.log(`   groups: ${groups.length - failed} | price rows: ${rows.toLocaleString()}${failed ? ` | failed: ${failed}` : ''}`);
