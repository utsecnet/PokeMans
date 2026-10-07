/**
 * Checks that what a reader sees matches what is stored, and that what is stored matches
 * what the source published.
 *
 *   node supabase/scripts/verifyPrices.mjs [--pct 10] [--day 2026-09-04] [--cache <dir>]
 *
 * Three readings of the same number, taken independently:
 *
 *   SOURCE  a real tcgcsv archive file on disk, not re-fetched -- their terms ask that a
 *           day's prices be pulled at most once a day, and today's pull already happened.
 *   STORED  price_point, read with the service key, which bypasses row policies.
 *   SHOWN   card_price_history called over an ordinary signed-in session, which is exactly
 *           the path the card page takes, policies and all.
 *
 * The third is the one that matters most and the easiest to leave untested. A service-key
 * read proves the data exists; it proves nothing about whether a user can see it, and those
 * came apart here before -- whole sets were present in the database and absent on screen.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const PCT = Number(arg('--pct', 10));
const DAY = arg('--day', null);
const CACHE = arg('--cache', '.');
const SOURCE_ID = 1;

const env = (f) => Object.fromEntries(
  fs.readFileSync(f, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const e = { ...env('client/.env.local'), ...env('supabase/.env') };

const service = createClient(e.VITE_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---------------------------------------------------------------- a real reader

/**
 * A signed-in session, so the "shown" reading goes through row policies like a browser.
 *
 * Created and deleted here rather than reusing a real account: the point is to read as an
 * ordinary user with no privileges, and the only way to be sure of that is to make one.
 */
async function asSignedInUser() {
  const email = `verify-${Date.now()}@example.invalid`;
  const password = `v${Math.random().toString(36).slice(2)}A1!`;
  const { data: created, error: createErr } =
    await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr) throw new Error(`could not create a test account: ${createErr.message}`);

  const anon = createClient(e.VITE_SUPABASE_URL, e.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`could not sign in: ${signInErr.message}`);

  return { client: anon, cleanup: () => service.auth.admin.deleteUser(created.user.id) };
}

// ---------------------------------------------------------------- the source

function readTarGz(gz) {
  const buf = zlib.gunzipSync(gz);
  const out = [];
  for (let off = 0; off + 512 <= buf.length;) {
    const name = buf.toString('utf8', off, off + 100).replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(buf.toString('ascii', off + 124, off + 136).replace(/\0.*$/, '').trim(), 8) || 0;
    const type = String.fromCharCode(buf[off + 156]);
    const start = off + 512;
    if (type === '0' || type === '\0') out.push({ name, data: buf.subarray(start, start + size) });
    off = start + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** productId|subType -> {market, low}, straight from an archive file. */
function loadSourceDay(day) {
  const direct = path.join(CACHE, `x-${day}`);
  const tarball = path.join(CACHE, `prices-${day}.tar.gz`);
  const prices = new Map();

  const take = (json) => {
    for (const r of JSON.parse(json).results ?? []) {
      if (r.marketPrice == null && r.lowPrice == null) continue;
      prices.set(`${r.productId}|${r.subTypeName}`, { market: r.marketPrice ?? null, low: r.lowPrice ?? null });
    }
  };

  if (fs.existsSync(tarball)) {
    for (const entry of readTarGz(fs.readFileSync(tarball))) {
      if (entry.name.endsWith('/prices')) { try { take(entry.data.toString('utf8')); } catch { /* one bad group */ } }
    }
    return prices;
  }
  if (fs.existsSync(direct)) {
    (function walk(p) {
      for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
        const f = path.join(p, entry.name);
        if (entry.isDirectory()) walk(f);
        else if (entry.name === 'prices') { try { take(fs.readFileSync(f, 'utf8')); } catch { /* one bad group */ } }
      }
    })(direct);
  }
  return prices;
}

// ---------------------------------------------------------------- run

const pageAll = async (client, table, cols, filter = (q) => q) => {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(client.from(table).select(cols)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
};

console.log('   loading catalogue and mappings…');
const cards = await pageAll(service, 'tcg_cards', 'id,name,set_id,set_name');
const maps = await pageAll(service, 'price_map', 'card_id,variant_position,external_id,sub_type',
  (q) => q.eq('source_id', SOURCE_ID));
const mapByCard = new Map();
for (const m of maps) {
  if (!mapByCard.has(m.card_id)) mapByCard.set(m.card_id, []);
  mapByCard.get(m.card_id).push(m);
}

// Deterministic sample, so a rerun inspects the same cards and a fix can be proven.
let seed = 20261007;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const sample = cards.filter(() => rand() < PCT / 100);
console.log(`   sampled ${sample.length.toLocaleString()} of ${cards.length.toLocaleString()} cards (${PCT}%)`);

const day = DAY ?? (fs.readdirSync(CACHE).map((f) => f.match(/^(?:x-|prices-)(\d{4}-\d{2}-\d{2})/)?.[1])
  .filter(Boolean).sort().pop());
const source = day ? loadSourceDay(day) : new Map();
console.log(`   source day: ${day ?? '(none found)'} — ${source.size.toLocaleString()} published prices`);

const { client: reader, cleanup } = await asSignedInUser();
console.log('   reading as an ordinary signed-in account');
console.log('');

const counts = {
  cards: sample.length, unmapped: 0, noStored: 0, shownOk: 0,
  shownMissing: 0, mismatchShown: 0, mismatchSource: 0, sourceAbsent: 0, checkedSource: 0,
};
const problems = [];

for (const c of sample) {
  const mappings = mapByCard.get(c.id) ?? [];
  if (mappings.length === 0) { counts.unmapped++; continue; }

  // STORED: what the database holds for that day, as the service role sees it.
  const { data: stored } = await service.from('price_point')
    .select('variant_position,market,low,captured_on')
    .eq('card_id', c.id).eq('source_id', SOURCE_ID)
    .lte('captured_on', day).order('captured_on', { ascending: false });

  if (!stored || stored.length === 0) { counts.noStored++; continue; }

  const storedByVariant = new Map();
  for (const r of stored) if (!storedByVariant.has(r.variant_position)) storedByVariant.set(r.variant_position, r);

  // SHOWN: what the card page would draw, read over a real session.
  const { data: charts, error: readErr } = await reader.rpc('card_price_history', { p_card_id: c.id, p_days: 365 });
  if (readErr) {
    problems.push(`${c.id} ${c.name}: the page read failed — ${readErr.message}`);
    counts.shownMissing++;
    continue;
  }

  const shown = new Map();
  for (const chart of charts ?? []) {
    for (const p of chart.printings ?? []) {
      const onDay = p.points.find((pt) => pt.day === day);
      if (onDay) shown.set(p.variantPosition, onDay);
    }
  }

  for (const [pos, row] of storedByVariant) {
    const seen = shown.get(pos);
    if (!seen) {
      // Stored but not drawn. Legitimate only when the printing has no market price at all,
      // which the chart deliberately omits rather than drawing at nothing.
      if (row.market !== null) {
        counts.shownMissing++;
        if (problems.length < 25) problems.push(`${c.id} pos ${pos}: stored $${row.market} but nothing shown`);
      }
      continue;
    }
    if (Number(seen.market) !== Number(row.market)) {
      counts.mismatchShown++;
      if (problems.length < 25) problems.push(`${c.id} pos ${pos}: shown $${seen.market} vs stored $${row.market}`);
    } else {
      counts.shownOk++;
    }

    // SOURCE: only for points actually captured on that day. A carried-forward value is
    // correct by design and says nothing about the source.
    if (row.captured_on === day) {
      const m = mappings.find((x) => x.variant_position === pos);
      const published = m ? source.get(`${m.external_id}|${m.sub_type}`) : null;
      if (!published) { counts.sourceAbsent++; continue; }
      counts.checkedSource++;
      if (Number(published.market) !== Number(row.market)) {
        counts.mismatchSource++;
        if (problems.length < 25) problems.push(`${c.id} pos ${pos}: stored $${row.market} vs source $${published.market}`);
      }
    }
  }
}

await cleanup();

const pct = (n) => (counts.cards ? (n / counts.cards * 100).toFixed(1) + '%' : '—');
console.log('   CARDS');
console.log('     sampled              ', String(counts.cards).padStart(6));
console.log('     no mapping           ', String(counts.unmapped).padStart(6), pct(counts.unmapped));
console.log('     mapped, nothing stored', String(counts.noStored).padStart(5), pct(counts.noStored));
console.log('');
console.log('   PRINTINGS  (stored vs shown on screen)');
console.log('     agree                ', String(counts.shownOk).padStart(6));
console.log('     stored but not shown ', String(counts.shownMissing).padStart(6));
console.log('     different value shown', String(counts.mismatchShown).padStart(6));
console.log('');
console.log('   STORED vs SOURCE  (points captured on ' + day + ')');
console.log('     compared             ', String(counts.checkedSource).padStart(6));
console.log('     disagree             ', String(counts.mismatchSource).padStart(6));
console.log('     not in that archive  ', String(counts.sourceAbsent).padStart(6));

if (problems.length) {
  console.log('');
  console.log('   PROBLEMS (first 25)');
  problems.forEach((p) => console.log('     ·', p));
} else {
  console.log('');
  console.log('   no discrepancies');
}
