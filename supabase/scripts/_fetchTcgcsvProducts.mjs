// Caches tcgcsv's product list for every Pokemon group. Products change only when a set
// is released, so this is cached on disk and not re-fetched for matching experiments.
import fs from 'node:fs';
import path from 'node:path';
const UA = { 'User-Agent': 'PokeMans/1.0 (collection tracker; contact rjohnson@utsec.net)' };
const OUT = process.argv[2] || '.';
const CACHE = path.join(OUT, 'tcgcsv_products.json');
if (fs.existsSync(CACHE)) { console.log('   cached already'); process.exit(0); }

const groups = (await (await fetch('https://tcgcsv.com/tcgplayer/3/groups', { headers: UA })).json()).results;
const byGroup = {};
const queue = [...groups];
let done = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const g = queue.pop();
    try {
      const r = await fetch(`https://tcgcsv.com/tcgplayer/3/${g.groupId}/products`, { headers: UA });
      if (r.ok) byGroup[g.groupId] = (await r.json()).results ?? [];
    } catch { /* recorded as missing below */ }
    if (++done % 50 === 0) console.log(`   ${done}/${groups.length}`);
  }
}));
fs.writeFileSync(CACHE, JSON.stringify({ groups, byGroup }));
const n = Object.values(byGroup).reduce((a, v) => a + v.length, 0);
console.log(`   groups: ${groups.length} | products: ${n.toLocaleString()}`);
