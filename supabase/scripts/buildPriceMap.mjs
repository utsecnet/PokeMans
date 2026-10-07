/**
 * Builds the join between our cards and TCGplayer's products, and reports what it could not
 * match rather than guessing.
 *
 *   node supabase/scripts/buildPriceMap.mjs [--apply] [--cache <dir>]
 *
 * Without --apply it only prints the report, which is the way to run it first: a mapping
 * that is quietly wrong produces prices on the wrong cards, and that is far harder to notice
 * than a mapping that is missing.
 *
 * Two things make this harder than an id lookup.
 *
 * Set names disagree. tcgcsv prefixes an era onto most of them -- our "Dragon" is their
 * "EX Dragon" -- and the nearest name to "Dragon" is "Dragon Majesty", a different set
 * eleven years later. So release date is the gate and the name only breaks ties within it.
 *
 * Printing names disagree too, and not uniformly. Modern sets price a plain card as
 * "Normal", but Base-era sets have no Normal at all: they have "1st Edition" and
 * "Unlimited". A fixed table from our vocabulary to theirs would therefore leave the whole
 * WotC era unpriced, so each printing is matched against the subtypes that product actually
 * publishes, in order of preference.
 *
 * KNOWN LIMITATION -- WotC-era editions share one price.
 *
 * We model edition as a property of the printing: base1-4 has four variants, differing by
 * subtype (unlimited, shadowless, 1999-2000-copyright) and stamp (1st-edition). TCGplayer
 * models it as a property of the *set*: "Base Set" and "Base Set (Shadowless)" are separate
 * groups holding separate products.
 *
 * So all four of our Charizard printings match the one product in the group we picked, and
 * all four show its price. They are not the same card and not the same money -- the
 * Shadowless Charizard was $1,213 the day this was written against $897 for the one we
 * mapped, and a 1st Edition is a different order of magnitude again.
 *
 * Fixing it means choosing the group from the variant rather than the set alone: a
 * shadowless printing should look in "<set> (Shadowless)" first. That is a real change to
 * the matching rather than a tweak, and it is worth doing before anyone reads a WotC price
 * as fact. Until then those cards carry one plausible figure for several distinct printings.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const CACHE = args.includes('--cache') ? args[args.indexOf('--cache') + 1] : '.';
const SOURCE_ID = 1; // tcgplayer

const env = (f) => Object.fromEntries(
  fs.readFileSync(f, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const e = { ...env('client/.env.local'), ...env('supabase/.env') };
const db = createClient(e.VITE_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const read = (f) => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));

// ---------------------------------------------------------------- normalising

// Diacritics are folded before anything else strips them. "Pokémon GO" and "Pokemon GO" are
// the same set, but dropping non-ASCII first turns ours into "pok mon go" and the two never
// meet -- which silently cost every set with an accent in its name.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const base = (s) => fold(s).replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

// With the era prefix removed, so our "Dragon" can meet their "EX Dragon".
const norm = (s) => base(s).replace(/^(me\d*|sv|swsh|sm|xy|bw|hgss|dp|ex)\s+/, '').trim();

/**
 * Compares two set names both ways and takes the better reading.
 *
 * Stripping the era is right when ours is the short name and theirs carries the prefix, and
 * wrong when the era *is* our whole name: "XY" and "Sun & Moon" are real set titles, and
 * stripping leaves nothing to match on. Scoring with and without, then taking the best, lets
 * one rule serve both without a list of exceptions.
 */
const pairScore = (mine, theirs) => Math.max(
  nameScore(norm(mine), norm(theirs)),
  nameScore(base(mine), base(theirs)),
  nameScore(base(mine), norm(theirs)),
  nameScore(norm(mine), base(theirs)),
);

const cardNum = (n) => String(n ?? '').trim().replace(/^0+/, '').toLowerCase();
const prodNum = (p) => String((p.extendedData ?? []).find((x) => x.name === 'Number')?.value ?? '')
  .split('/')[0].trim().replace(/^0+/, '').toLowerCase();

const dayGap = (a, b) => (!a || !b) ? Infinity : Math.abs(new Date(a) - new Date(b)) / 86400000;

function nameScore(a, b) {
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a)) return 0.92;
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.max(A.size, B.size);
}

/**
 * Our printing vocabulary against theirs, most specific first.
 *
 * Order matters and encodes an era. A plain card is "Normal" in a modern set but the WotC
 * sets have only "1st Edition" and "Unlimited", so those are listed as fallbacks rather than
 * being treated as separate printings we do not track. Taking the first that the product
 * actually publishes keeps both eras working without a special case.
 */
const SUBTYPE_PREFERENCE = {
  normal:  ['Normal', 'Unlimited', '1st Edition'],
  holo:    ['Holofoil', 'Unlimited Holofoil', '1st Edition Holofoil'],
  reverse: ['Reverse Holofoil'],
  metal:   ['Normal'],
};

// ---------------------------------------------------------------- load

const { groups, byGroup } = read('tcgcsv_products.json');
const mySets = read('my_sets.json');
const myCards = read('my_cards.json');
const myVars = read('my_vars.json');

// Which subtypes each product actually publishes a price for. Learned from a real price
// file rather than assumed, because the answer differs by era and by product.
const subTypesByProduct = new Map();
const priceDir = fs.readdirSync(CACHE).find((d) => d.startsWith('d_prices-'));
if (!priceDir) {
  console.error('   no extracted price day found in the cache; need one to learn subtypes');
  process.exit(1);
}
(function walk(p) {
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, entry.name);
    if (entry.isDirectory()) walk(f);
    else if (entry.name === 'prices') {
      try {
        for (const r of JSON.parse(fs.readFileSync(f, 'utf8')).results ?? []) {
          if (!subTypesByProduct.has(r.productId)) subTypesByProduct.set(r.productId, new Set());
          subTypesByProduct.get(r.productId).add(r.subTypeName);
        }
      } catch { /* a malformed group file is reported by the coverage count, not fatal */ }
    }
  }
})(path.join(CACHE, priceDir));

// ---------------------------------------------------------------- sets

const setToGroup = new Map();
const setsForReview = [];
for (const s of mySets) {
  let best = null, bestScore = 0;
  for (const g of groups) {
    const ns = pairScore(s.name, g.name);
    const gap = dayGap(s.release_date, g.publishedOn);
    // Date is the gate, because name alone cannot tell "Dragon" from "Dragon Majesty". A
    // near-identical name is allowed through without it, which is what rescues the promo
    // sets: they accumulate over years, so their published date never lines up.
    if (!(gap <= 60 ? ns >= 0.5 : ns >= 0.9)) continue;
    const score = ns + (gap <= 60 ? 0.5 : 0) + (gap <= 7 ? 0.3 : 0);
    if (score > bestScore) { bestScore = score; best = g; }
  }
  if (best && bestScore >= 1.0) setToGroup.set(s.id, best.groupId);
  else setsForReview.push({ id: s.id, name: s.name, released: s.release_date, nearest: best?.name ?? null });
}

// ---------------------------------------------------------------- cards

const variantsByCard = new Map();
for (const v of myVars) {
  if (!variantsByCard.has(v.card_id)) variantsByCard.set(v.card_id, []);
  variantsByCard.get(v.card_id).push(v);
}

const rows = [];
const unmatchedCards = [];
const unmatchedPrintings = [];
let byNumber = 0, byName = 0, noGroup = 0;

const cardsBySet = new Map();
for (const c of myCards) {
  if (!cardsBySet.has(c.set_id)) cardsBySet.set(c.set_id, []);
  cardsBySet.get(c.set_id).push(c);
}

for (const [setId, cards] of cardsBySet) {
  const gid = setToGroup.get(setId);
  if (!gid) { noGroup += cards.length; continue; }
  const prods = byGroup[gid] ?? [];
  const numIdx = new Map(), nameIdx = new Map();
  for (const p of prods) {
    const n = prodNum(p);
    if (n && !numIdx.has(n)) numIdx.set(n, p);
    const nm = norm(p.name);
    if (!nameIdx.has(nm)) nameIdx.set(nm, p);
  }

  for (const c of cards) {
    let prod = numIdx.get(cardNum(c.number));
    let how = 'number';
    if (!prod) { prod = nameIdx.get(norm(c.name)); how = 'name'; }
    if (!prod) { unmatchedCards.push(`${c.set_name} #${c.number} ${c.name} (${c.id})`); continue; }
    how === 'number' ? byNumber++ : byName++;

    const available = subTypesByProduct.get(prod.productId) ?? new Set();
    for (const v of variantsByCard.get(c.id) ?? []) {
      const wanted = SUBTYPE_PREFERENCE[v.type] ?? [];
      const sub = wanted.find((w) => available.has(w));
      if (!sub) {
        unmatchedPrintings.push(`${c.id} ${v.type} → product ${prod.productId} has [${[...available].join(', ') || 'no prices'}]`);
        continue;
      }
      rows.push({
        card_id: c.id,
        variant_position: v.position,
        source_id: SOURCE_ID,
        external_id: prod.productId,
        sub_type: sub,
        matched_by: how,
      });
    }
  }
}

// ---------------------------------------------------------------- report

const totalCards = myCards.length;
const totalPrintings = myVars.length;
const pct = (n, d) => (n / d * 100).toFixed(1) + '%';

console.log('');
console.log('   SETS');
console.log('     matched          ', setToGroup.size, 'of', mySets.length);
console.log('     needs review     ', setsForReview.length);
for (const s of setsForReview) console.log(`       · ${s.name} (${s.released ?? '?'}) nearest: ${s.nearest ?? 'nothing'}`);

console.log('');
console.log('   CARDS  (of ' + totalCards.toLocaleString() + ')');
console.log('     by set + number  ', String(byNumber).padStart(6), pct(byNumber, totalCards));
console.log('     by set + name    ', String(byName).padStart(6), pct(byName, totalCards));
console.log('     set unmatched    ', String(noGroup).padStart(6), pct(noGroup, totalCards));
console.log('     card unmatched   ', String(unmatchedCards.length).padStart(6), pct(unmatchedCards.length, totalCards));

console.log('');
console.log('   PRINTINGS  (of ' + totalPrintings.toLocaleString() + ')');
console.log('     mapped           ', String(rows.length).padStart(6), pct(rows.length, totalPrintings));
console.log('     no subtype       ', String(unmatchedPrintings.length).padStart(6), pct(unmatchedPrintings.length, totalPrintings));
for (const u of unmatchedPrintings.slice(0, 6)) console.log('       ·', u);

if (!APPLY) {
  console.log('');
  console.log('   dry run — nothing written. Re-run with --apply to write price_map.');
  process.exit(0);
}

// ---------------------------------------------------------------- write

console.log('');
console.log('   writing', rows.length.toLocaleString(), 'rows…');
const SIZE = 1000;
let written = 0;
for (let i = 0; i < rows.length; i += SIZE) {
  const chunk = rows.slice(i, i + SIZE);
  const { error } = await db.from('price_map')
    .upsert(chunk, { onConflict: 'card_id,variant_position,source_id' });
  if (error) { console.error('   failed at row', i, '-', error.message); process.exit(1); }
  written += chunk.length;
  if (written % 10000 === 0 || written === rows.length) console.log('     ', written.toLocaleString());
}
console.log('   done:', written.toLocaleString(), 'printings mapped');
