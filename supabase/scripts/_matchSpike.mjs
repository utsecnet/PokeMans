// Measures how well tcgcsv lines up with our catalogue, and reports what does not match.
//
// Name similarity alone is not safe here: tcgcsv prefixes an era onto most set names
// ("EX Dragon", "SM Base Set"), and the nearest name to our "Dragon" is "Dragon Majesty" --
// a different set, eleven years later. Release date is the discriminator that actually
// separates them, so a candidate must agree on date *and* name before it counts.
import fs from 'node:fs';
import path from 'node:path';
const D = process.argv[2] || '.';
const read = (f) => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));

const mySets = read('my_sets.json');
const myCards = read('my_cards.json');
const { groups, byGroup } = read('tcgcsv_products.json');

const norm = (s) => String(s ?? '').toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/^(me\d*|sv|swsh|sm|xy|bw|hgss|dp|ex)\s*:?\s+/i, '')   // era prefix
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

const days = (a, b) => (!a || !b) ? Infinity : Math.abs(new Date(a) - new Date(b)) / 86400000;
const tokens = (s) => new Set(s.split(' ').filter(Boolean));
function nameScore(a, b) {
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a)) return 0.92;
  const A = tokens(a), B = tokens(b);
  let hit = 0; for (const t of A) if (B.has(t)) hit++;
  return hit / Math.max(A.size, B.size);
}

const setMap = new Map();
const review = [];
for (const s of mySets) {
  const n = norm(s.name);
  let best = null, bestScore = 0, bestDays = Infinity;
  for (const g of groups) {
    const gn = norm(g.name);
    const ns = nameScore(n, gn);
    const dd = days(s.release_date, g.publishedOn);
    // Date agreement is the gate; name breaks ties within it.
    const ok = dd <= 60 ? ns >= 0.5 : ns >= 0.99;
    if (!ok) continue;
    const score = ns + (dd <= 60 ? 0.5 : 0) + (dd <= 7 ? 0.3 : 0);
    if (score > bestScore) { bestScore = score; best = g; bestDays = dd; }
  }
  if (best && bestScore >= 1.0) setMap.set(s.id, { gid: best.groupId, name: best.name, score: bestScore, dd: bestDays });
  else review.push({ s, best, bestScore, bestDays });
}

console.log('   SETS → GROUPS');
console.log('     confident :', setMap.size, 'of', mySets.length);
console.log('     review    :', review.length);
review.slice(0, 10).forEach((r) =>
  console.log(`       · ${JSON.stringify(r.s.name)} (${r.s.release_date ?? '?'}) → ${r.best ? JSON.stringify(r.best.name) : 'nothing'}`));

const cardNum = (n) => String(n ?? '').trim().replace(/^0+/, '').toLowerCase();
const prodNum = (p) => String((p.extendedData ?? []).find((e) => e.name === 'Number')?.value ?? '')
  .split('/')[0].trim().replace(/^0+/, '').toLowerCase();

let byNumber = 0, byName = 0, missed = 0, noGroup = 0;
const miss = [];
const bySet = new Map();
for (const c of myCards) { if (!bySet.has(c.set_id)) bySet.set(c.set_id, []); bySet.get(c.set_id).push(c); }
for (const [setId, cards] of bySet) {
  const m = setMap.get(setId);
  if (!m) { noGroup += cards.length; continue; }
  const prods = byGroup[m.gid] ?? [];
  const numIdx = new Map(), nameIdx = new Map();
  for (const p of prods) {
    const n = prodNum(p); if (n && !numIdx.has(n)) numIdx.set(n, p);
    const nm = norm(p.name); if (!nameIdx.has(nm)) nameIdx.set(nm, p);
  }
  for (const c of cards) {
    if (numIdx.has(cardNum(c.number))) byNumber++;
    else if (nameIdx.has(norm(c.name))) byName++;
    else { missed++; if (miss.length < 8) miss.push(`${c.set_name} #${c.number} ${c.name}`); }
  }
}
const total = myCards.length, pct = (n) => (n / total * 100).toFixed(1) + '%';
console.log('');
console.log('   CARDS → PRODUCTS  (of ' + total.toLocaleString() + ')');
console.log('     by set+number :', String(byNumber).padStart(7), pct(byNumber));
console.log('     by set+name   :', String(byName).padStart(7), pct(byName));
console.log('     no group      :', String(noGroup).padStart(7), pct(noGroup));
console.log('     unmatched     :', String(missed).padStart(7), pct(missed));
console.log('     ────────────────────────────────');
console.log('     COVERED       :', String(byNumber + byName).padStart(7), pct(byNumber + byName));
miss.forEach((m) => console.log('       ·', m));
