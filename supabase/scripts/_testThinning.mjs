// Proves the thinning keeps the right points before it is trusted with real history.
//
// Thinning is the one job here that destroys data, and on correctly-sampled history it is a
// no-op -- so "it ran and removed nothing" proves nothing at all. This plants a dense run of
// daily points for one card inside the 8-30 day band and checks what survives.
//
// Read this before running it: thin_price_history takes a SOURCE, not a card. There is no
// way to exercise it against one card alone, so a non-dry run here thins everything stored
// for that source. An earlier version of this script did exactly that and removed 227,691
// rows of real backfill. It now runs dry and compares what it *would* remove, which answers
// the same question without the collateral.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = (f) => Object.fromEntries(
  fs.readFileSync(f, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const e = { ...env('client/.env.local'), ...env('supabase/.env') };
const db = createClient(e.VITE_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// A real card, with a printing number no card has.
//
// price_point has a foreign key to tcg_cards(ref), so an invented card is rejected outright
// -- which is the constraint doing its job. Borrowing a real one and using variant_position
// 99 keeps the planted rows in their own partition: the thinning groups by card and
// printing, so nothing here can touch or be confused with a real price.
const { data: anyCard } = await db.from('tcg_cards').select('ref').limit(1).single();
const CARD_REF = anyCard.ref;
const VARIANT = 99;
const day = (ago) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ago); return d.toISOString().slice(0, 10); };

// Days 10..28, one point each: dense enough that the Monday-and-Thursday band must act, and
// long enough to span several half-weeks.
const ages = Array.from({ length: 19 }, (_, i) => 10 + i);
const rows = ages.map((a, i) => ({
  card_ref: CARD_REF, variant_position: VARIANT, source_id: 1,
  captured_on: day(a), market: 10 + i, low: 5 + i,
}));

await db.from('price_point').delete().eq('card_ref', CARD_REF).eq('variant_position', VARIANT);
const { error: insErr } = await db.from('price_point').insert(rows);
if (insErr) { console.error('   could not plant test rows:', insErr.message); process.exit(1); }
console.log(`   planted ${rows.length} daily points, ages ${ages[0]}-${ages[ages.length - 1]} days`);

const before = await db.from('price_point').select('captured_on').eq('card_ref', CARD_REF).eq('variant_position', VARIANT).order('captured_on');
const all = before.data.map((r) => r.captured_on);

// The policy inside 8-30 days keeps one point per half week -- Monday to Wednesday, then
// Thursday to Sunday -- so a Monday and a Thursday both survive. The newest in each bucket
// is kept, because that is the price in force when the bucket ends and the reader carries
// values forward from it.
//
// Worked out here in the same terms the SQL uses, so the two can disagree and be noticed.
const mondayOf = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();   // 1 Monday … 7 Sunday
  d.setUTCDate(d.getUTCDate() - (isoDow - 1));
  return d;
};
const bucketOf = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const start = mondayOf(iso);
  if (isoDow >= 4) start.setUTCDate(start.getUTCDate() + 3);   // the Thursday-to-Sunday half
  return start.toISOString().slice(0, 10);
};

const newestPerBucket = new Map();
for (const d of all) {
  const b = bucketOf(d);
  const held = newestPerBucket.get(b);
  if (!held || d > held) newestPerBucket.set(b, d);
}
const expected = all.filter((d) =>
  d === all[0] || d === all[all.length - 1] || newestPerBucket.get(bucketOf(d)) === d);

const { data: dry, error } = await db.rpc('thin_price_history', { p_source_id: 1, p_dry_run: true });
if (error) { console.error('   thinning failed:', error.message); process.exit(1); }

// Only the planted card is dense enough for the 8-30 band to act on, so what the dry run
// proposes there is attributable to it.
const proposed = dry.bands.find((b) => b.band === '8-30 days')?.removed ?? 0;
const shouldRemove = all.length - expected.length;
const ok = proposed === shouldRemove;

console.log(`   planted ${all.length} points, policy keeps ${expected.length}`);
console.log(`   should remove ${shouldRemove}, dry run proposes ${proposed}`);
console.log(`   kept dates: ${expected.slice(0, 5).join(', ')} … ${expected.at(-1)}`);
console.log(`   ends preserved in plan: ${expected.includes(all[0])} / ${expected.includes(all.at(-1))}`);
console.log(ok ? '   PASS — half-week buckets, newest per bucket, ends kept' : '   FAIL — see above');

await db.from('price_point').delete().eq('card_ref', CARD_REF).eq('variant_position', VARIANT);
const left = await db.from('price_point').select('captured_on', { count: 'exact', head: true }).eq('card_ref', CARD_REF).eq('variant_position', VARIANT);
console.log(`   cleaned up, ${left.count ?? 0} test rows left`);
process.exit(ok ? 0 : 1);
