// Proves the thinning keeps the right points before it is trusted with real history.
//
// Thinning is the one job here that destroys data, and on correctly-sampled history it is a
// no-op -- so "it ran and removed nothing" proves nothing at all. This plants a dense run of
// daily points for one card inside the 8-30 day band, asks for a dry run, and checks that
// what survives is every second point plus the first and last, then removes the plant.
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
const { data: result, error } = await db.rpc('thin_price_history', { p_source_id: 1, p_dry_run: false });
if (error) { console.error('   thinning failed:', error.message); process.exit(1); }

const after = await db.from('price_point').select('captured_on').eq('card_id', CARD).order('captured_on');
const kept = after.data.map((r) => r.captured_on);
const all = before.data.map((r) => r.captured_on);

// Expected: index 0, the last index, and every 2nd from the start.
const expected = all.filter((_, i) => i === 0 || i === all.length - 1 || i % 2 === 0);
const ok = kept.length === expected.length && kept.every((d, i) => d === expected[i]);

console.log(`   before ${all.length} points → after ${kept.length}`);
console.log(`   expected ${expected.length}: ${expected.slice(0, 4).join(', ')} … ${expected.at(-1)}`);
console.log(`   actual   ${kept.length}: ${kept.slice(0, 4).join(', ')} … ${kept.at(-1)}`);
console.log(`   first kept: ${kept[0] === all[0]}   last kept: ${kept.at(-1) === all.at(-1)}`);
console.log(ok ? '   PASS — every 2nd point kept, ends preserved' : '   FAIL — see above');

await db.from('price_point').delete().eq('card_id', CARD);
const left = await db.from('price_point').select('captured_on', { count: 'exact', head: true }).eq('card_id', CARD);
console.log(`   cleaned up, ${left.count ?? 0} test rows left`);
process.exit(ok ? 0 : 1);
