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
 * Era names, spelled out on our side and abbreviated on theirs.
 *
 * Our "Sun & Moon" is their "SM Base Set" -- not one word in common, so every name rule
 * scored it zero and the set went unmatched entirely, all 173 cards unpriced. Expanding the
 * abbreviation before comparing is what lets the two meet.
 */
const ERA_ALIASES = {
  swsh: 'sword and shield',
  hgss: 'heartgold and soulsilver',
  sm: 'sun and moon',
  sv: 'scarlet and violet',
  bw: 'black and white',
  dp: 'diamond and pearl',
  xy: 'xy',
};

// Longest alternatives first, so "swsh01" is not read as "sw" plus noise. The trailing
// digits are a release index -- "SV01", "SWSH01" -- and not part of the abbreviation.
//
// Written as a literal rather than built from a string: the first attempt assembled it with
// new RegExp('^' + abbr + '\d*\s+'), where JavaScript quietly drops the backslash in a
// string literal, leaving the pattern ^svd*s+ which matches nothing at all. It failed
// silently and took three sets' prices with it.
const ERA_PATTERN = /^(swsh|hgss|sm|sv|bw|dp|xy)(\d*)\s+/;

/** The same name with a leading era abbreviation spelled out, when it carries one. */
function expandEra(s) {
  const t = base(s);
  const m = t.match(ERA_PATTERN);
  if (!m) return t;
  return `${ERA_ALIASES[m[1]]} ${t.slice(m[0].length)}`.trim();
}

/**
 * Whether exactly one of the two names calls itself a promo set.
 *
 * Promo sets are the single most dangerous near-match here, because they are named after
 * the set they accompany and usually carry its release date too -- so they beat the real
 * set on both name and date. "Diamond & Pearl" matched "Diamond and Pearl Promos" and took
 * 66 promo products instead of 135 real ones, leaving 125 of 130 cards unpriced.
 */
const PROMO_WORDS = new Set(["promo", "promos"]);
const isPromoSet = (name) => base(name).split(" ").some((w) => PROMO_WORDS.has(w));
const promoMismatch = (a, b) => isPromoSet(a) !== isPromoSet(b);

/**
 * Compares two set names both ways and takes the better reading.
 *
 * Stripping the era is right when ours is the short name and theirs carries the prefix, and
 * wrong when the era *is* our whole name: "XY" and "Sun & Moon" are real set titles, and
 * stripping leaves nothing to match on. Scoring with and without, then taking the best, lets
 * one rule serve both without a list of exceptions.
 */
const pairScore = (mine, theirs) => {
  const best = Math.max(
    nameScore(norm(mine), norm(theirs)),
    nameScore(base(mine), base(theirs)),
    nameScore(base(mine), norm(theirs)),
    nameScore(norm(mine), base(theirs)),
    nameScore(base(mine), expandEra(theirs)),
    nameScore(expandEra(mine), expandEra(theirs)),
    nameScore(base(mine), norm(expandEra(theirs))),
  );
  // One of them is a promo set and the other is not. Never let that win on a tie-break.
  return promoMismatch(mine, theirs) ? best * 0.45 : best;
};

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
 * Our printing against theirs, most specific first.
 *
 * The edition is the hard part, and the two catalogues disagree about where it lives.
 *
 * We make it a property of the printing: a Base Set Charizard is four variants, separated by
 * subtype (unlimited, shadowless, 1999-2000-copyright) and stamp (1st-edition). TCGplayer
 * splits it two different ways depending on the set. For Base it is a separate *group* --
 * "Base Set" holds the Unlimited printing, "Base Set (Shadowless)" holds the shadowless and
 * first-edition ones. For Jungle, Fossil, Team Rocket, Gym and Neo there is one group and
 * the edition rides on the subtype instead: "1st Edition Holofoil" beside "Unlimited
 * Holofoil".
 *
 * So matching reads the stamp first and the type second, and falls back to the generic name
 * when a set does not draw the distinction at all. A modern set publishes only "Normal", and
 * asking for "Unlimited" there simply misses and falls through, which is the intended
 * behaviour rather than an accident.
 *
 * Getting this wrong is expensive in the literal sense: on the day this was written a
 * Shadowless Charizard was $1,213 against $897 for the Unlimited, and a 1st Edition is a
 * different order of magnitude again. Before this, all four printings carried the one price.
 */
function subtypePreference(variant) {
  const firstEdition = variant.stamp === '1st-edition';
  switch (variant.type) {
    case 'holo':
      // "Holofoil" is the generic name a set uses when it draws no edition distinction at
      // all, so both branches may fall back to it. Neither falls back to the *other*
      // edition: a first edition is never given unlimited money, or the whole exercise is
      // pointless.
      return firstEdition
        ? ['1st Edition Holofoil', 'Holofoil']
        : ['Unlimited Holofoil', 'Holofoil'];
    case 'reverse':
      return ['Reverse Holofoil'];
    case 'normal':
    case 'metal':
      return firstEdition
        ? ['1st Edition', 'Normal']
        : ['Unlimited', 'Normal'];
    default:
      return ['Normal'];
  }
}

/**
 * Which of a set's groups a printing belongs in.
 *
 * Only Base Set is split this way, but the rule is written generally: a shadowless printing
 * looks for "<set> (Shadowless)" and uses it when it exists, and everything else stays in
 * the set's main group. A set without the split simply never matches the alternate.
 */
function groupForVariant(variant, main, alternates) {
  if (variant.subtype === 'shadowless' && alternates.shadowless) return alternates.shadowless;
  return main;
}

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
const setAlternates = new Map();   // set id -> { shadowless: groupId }
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
    // Name carries more weight than date, because promo sets routinely share their parent
    // set's release date: a 0.3 bonus for landing on the same day was enough to beat an
    // exact name match, which is how a base set lost to its own promo set.
    const score = ns * 2 + (gap <= 60 ? 0.4 : 0) + (gap <= 7 ? 0.15 : 0);
    if (score > bestScore) { bestScore = score; best = g; }
  }
  if (best && bestScore >= 1.4) {
    setToGroup.set(s.id, best.groupId);
    // TCGplayer keeps the shadowless and first-edition printings of Base Set in a group of
    // their own. Find it here so a variant can be routed to it below.
    const shadowless = groups.find((g) => norm(g.name) === norm(`${best.name} (Shadowless)`)
      || base(g.name) === base(`${best.name} (Shadowless)`));
    if (shadowless) setAlternates.set(s.id, { shadowless: shadowless.groupId });
  } else {
    setsForReview.push({ id: s.id, name: s.name, released: s.release_date, nearest: best?.name ?? null });
  }
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

/** Builds number and name indexes over one group's products. */
function indexGroup(gid) {
  const numIdx = new Map(), nameIdx = new Map();
  for (const p of byGroup[gid] ?? []) {
    const n = prodNum(p);
    if (n && !numIdx.has(n)) numIdx.set(n, p);
    const nm = norm(p.name);
    if (!nameIdx.has(nm)) nameIdx.set(nm, p);
  }
  return { numIdx, nameIdx };
}

for (const [setId, cards] of cardsBySet) {
  const gid = setToGroup.get(setId);
  if (!gid) { noGroup += cards.length; continue; }

  const alternates = setAlternates.get(setId) ?? {};
  // Each group this set's printings might live in gets its own index, built once.
  const indexes = new Map([[gid, indexGroup(gid)]]);
  for (const altGid of Object.values(alternates)) {
    if (!indexes.has(altGid)) indexes.set(altGid, indexGroup(altGid));
  }

  for (const c of cards) {
    const variants = variantsByCard.get(c.id) ?? [];
    let matchedThisCard = false;

    for (const v of variants) {
      // The group is chosen per printing, not per card: a shadowless Charizard and an
      // unlimited one are the same card to us and two different products to TCGplayer.
      const targetGid = groupForVariant(v, gid, alternates);
      const idx = indexes.get(targetGid) ?? indexes.get(gid);

      let prod = idx.numIdx.get(cardNum(c.number));
      let how = 'number';
      if (!prod) { prod = idx.nameIdx.get(norm(c.name)); how = 'name'; }
      // Deliberately no fallback to the main group for an edition-bearing printing.
      //
      // A shadowless card missing from the shadowless group could be given the unlimited
      // product's price instead, and it would look perfectly reasonable -- which is exactly
      // the failure being fixed here. A printing with no price draws no line and invites a
      // question; a printing wearing another edition's money answers that question wrongly
      // and nobody asks again.
      if (!prod && targetGid !== gid) continue;
      if (!prod) continue;

      if (!matchedThisCard) {
        matchedThisCard = true;
        how === 'name' ? byName++ : byNumber++;
      }

      const available = subTypesByProduct.get(prod.productId) ?? new Set();
      const sub = subtypePreference(v).find((w) => available.has(w));
      if (!sub) {
        unmatchedPrintings.push(
          `${c.id} ${v.type}${v.stamp ? '/' + v.stamp : ''}${v.subtype ? '/' + v.subtype : ''}`
          + ` → product ${prod.productId} has [${[...available].join(', ') || 'no prices'}]`);
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

    if (!matchedThisCard) unmatchedCards.push(`${c.set_name} #${c.number} ${c.name} (${c.id})`);
  }
}

// ---------------------------------------------------------------- report

const totalCards = myCards.length;
const totalPrintings = myVars.length;
const pct = (n, d) => (n / d * 100).toFixed(1) + '%';

// --why <setId> shows every candidate group considered for one set, with its score and
// whether it passed the gate. The only reliable way to see why a set chose what it chose.
if (args.includes('--why')) {
  const want = args[args.indexOf('--why') + 1];
  const s = mySets.find((x) => x.id === want);
  console.log('');
  console.log(`   WHY ${want} (${JSON.stringify(s?.name)}, ${s?.release_date})`);
  const scored = groups.map((g) => {
    const ns = pairScore(s.name, g.name);
    const gap = dayGap(s.release_date, g.publishedOn);
    const passes = gap <= 60 ? ns >= 0.5 : ns >= 0.9;
    const score = ns * 2 + (gap <= 60 ? 0.4 : 0) + (gap <= 7 ? 0.15 : 0);
    return { name: g.name, id: g.groupId, ns, gap, passes, score, promo: promoMismatch(s.name, g.name) };
  }).sort((a, b) => (b.passes - a.passes) || (b.score - a.score)).slice(0, 6);
  for (const c of scored) {
    console.log(`     ${c.passes ? 'PASS' : 'skip'}  score ${c.score.toFixed(2)}  ns ${c.ns.toFixed(3)}  gap ${String(c.gap).padStart(5)}d  promoMismatch=${c.promo}  ${JSON.stringify(c.name)}`);
  }
}

// --groups prints which tcgcsv group each of our sets was matched to, which is the first
// thing to check when a whole set comes back unpriced.
if (args.includes('--groups')) {
  const want = args[args.indexOf('--groups') + 1];
  const ids = want && !want.startsWith('--') ? want.split(',') : null;
  console.log('');
  console.log('   SET → GROUP');
  for (const s of mySets) {
    if (ids && !ids.includes(s.id)) continue;
    const gid = setToGroup.get(s.id);
    const g = groups.find((g) => g.groupId === gid);
    console.log(`     ${s.id.padEnd(10)}${JSON.stringify(s.name).padEnd(34)} → ${g ? JSON.stringify(g.name) + ' (' + gid + ', ' + (byGroup[gid] ?? []).length + ' products)' : 'UNMATCHED'}`);
  }
}

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

// --inspect <cardId> prints what one card would be mapped to, which is the only practical
// way to check an edition split without writing 28,000 rows first.
if (args.includes('--inspect')) {
  const want = args[args.indexOf('--inspect') + 1];
  const mine = myCards.find((c) => c.id === want);
  console.log('');
  console.log(`   ${want}  ${mine?.name ?? '?'}  (${mine?.set_name ?? '?'})`);
  for (const r of rows.filter((r) => r.card_id === want)) {
    const v = (variantsByCard.get(want) ?? []).find((v) => v.position === r.variant_position);
    const label = [v?.type, v?.subtype, v?.stamp].filter(Boolean).join(' / ');
    const prodName = Object.values(byGroup).flat().find((p) => p.productId === r.external_id)?.name ?? '?';
    console.log(`     pos ${r.variant_position}  ${label.padEnd(34)} → ${r.external_id} ${JSON.stringify(prodName)} / ${r.sub_type}`);
  }
}

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

// Rows this run did not produce are left over from an earlier mapping, and a stale row is
// worse than a missing one: it keeps pointing a printing at a product the current rules
// rejected, so a price keeps arriving for it and keeps being wrong.
const keep = new Set(rows.map((r) => `${r.card_id}|${r.variant_position}`));
const existing = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('price_map')
    .select('card_id,variant_position').eq('source_id', SOURCE_ID).range(from, from + 999);
  if (error) { console.error('   could not list existing rows:', error.message); break; }
  existing.push(...data);
  if (data.length < 1000) break;
}
const stale = existing.filter((r) => !keep.has(`${r.card_id}|${r.variant_position}`));
if (stale.length) {
  console.log(`   removing ${stale.length} rows the current rules no longer produce…`);
  for (const r of stale) {
    await db.from('price_map').delete()
      .eq('source_id', SOURCE_ID).eq('card_id', r.card_id).eq('variant_position', r.variant_position);
  }
  // Their prices go too. A printing with no mapping should have no price, and leaving the
  // old rows behind would keep a wrong-edition figure on the chart with nothing producing it.
  for (const r of stale) {
    await db.from('price_latest').delete()
      .eq('source_id', SOURCE_ID).eq('card_id', r.card_id).eq('variant_position', r.variant_position);
    await db.from('price_point').delete()
      .eq('source_id', SOURCE_ID).eq('card_id', r.card_id).eq('variant_position', r.variant_position);
  }
}
console.log(`   price_map now holds ${rows.length.toLocaleString()} rows`);
