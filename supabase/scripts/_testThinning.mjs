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

const CARD = '__thinning-test__';
const day = (ago) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ago); return d.toISOString().slice(0, 10); };

// Days 10..28, one point each: dense enough that the "every 2nd day" band must act.
const ages = Array.from({ length: 19 }, (_, i) => 10 + i);
const rows = ages.map((a, i) => ({
  card_id: CARD, variant_position: 0, source_id: 1,
  captured_on: day(a), market: 10 + i, low: 5 + i,
}));

await db.from('price_point').delete().eq('card_id', CARD);
const { error: insErr } = await db.from('price_point').insert(rows);
if (insErr) { console.error('   could not plant test rows:', insErr.message); process.exit(1); }
console.log(`   planted ${rows.length} daily points, ages ${ages[0]}-${ages[ages.length - 1]} days`);

const before = await db.from('price_point').select('captured_on').eq('card_id', CARD).order('captured_on');
const all = before.data.map((r) => r.captured_on);

// The policy is a calendar one: within 8-30 days, keep one point per two-day bucket, and the
// newest in each bucket because that is the value in force when the bucket ends. Buckets are
// counted in whole days back from today, so this mirrors the SQL rather than restating it.
const today = new Date();
const ageOf = (d) => Math.round((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  - Date.parse(d + 'T00:00:00Z')) / 86400000);
const newestPerBucket = new Map();
for (const d of all) {
  const bucket = Math.floor(ageOf(d) / 2);
  const held = newestPerBucket.get(bucket);
  if (!held || d > held) newestPerBucket.set(bucket, d);
}
const expected = all.filter((d) =>
  d === all[0] || d === all[all.length - 1] || newestPerBucket.get(Math.floor(ageOf(d) / 2)) === d);

const { data: dry, error } = await db.rpc('thin_price_history', { p_source_id: 1, p_dry_run: true });
if (error) { console.error('   thinning failed:', error.message); process.exit(1); }

// Only the planted card is dense enough for the 8-30 band to act on, so what the dry run
// proposes there is attributable to it.
const proposed = dry.bands.find((b) => b.fromAge === 8)?.removed ?? 0;
const shouldRemove = all.length - expected.length;
const ok = proposed === shouldRemove;

console.log(`   planted ${all.length} points, policy keeps ${expected.length}`);
console.log(`   should remove ${shouldRemove}, dry run proposes ${proposed}`);
console.log(`   kept dates: ${expected.slice(0, 5).join(', ')} … ${expected.at(-1)}`);
console.log(`   ends preserved in plan: ${expected.includes(all[0])} / ${expected.includes(all.at(-1))}`);
console.log(ok ? '   PASS — calendar buckets, newest per bucket, ends kept' : '   FAIL — see above');

await db.from('price_point').delete().eq('card_id', CARD);
const left = await db.from('price_point').select('captured_on', { count: 'exact', head: true }).eq('card_id', CARD);
console.log(`   cleaned up, ${left.count ?? 0} test rows left`);
process.exit(ok ? 0 : 1);
