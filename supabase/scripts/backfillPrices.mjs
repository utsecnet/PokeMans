/**
 * Loads historical TCGplayer prices from the pokefolio-data mirror.
 *
 *   node supabase/scripts/backfillPrices.mjs [--days 90] [--apply] [--cache <dir>] [--new-only]
 *
 * --new-only restricts the load to printings that have no history worth the name -- ones
 * whose mapping arrived late, so they have today's price and nothing before it. Without it
 * a re-run rewrites two and a half years for all 32,265 printings, and because the change
 * detection below starts empty it writes a row for every one of them on the first sampled
 * day whether the value moved or not.
 *
 * tcgcsv used to publish a daily archive going back to 2024-02-08 and has withdrawn it --
 * "temporarily removed due to rising server costs", with no way to appeal. That archive
 * survives in a GitHub mirror, which is currently the only free copy of this history
 * anywhere. Every day not captured is permanently gone, so this exists to be run once, soon.
 *
 * Two things keep it from flooding the database.
 *
 * The retention bands are applied as it loads rather than afterwards. Loading 90 days and
 * then thinning would write about 2.5 million rows to delete two thirds of them, briefly
 * tripling the database for no reason; sampling the same dates the policy would have kept
 * means only ~38 days are ever fetched.
 *
 * And a row is written only where the price differs from the previous sampled day, which is
 * the same rule the daily capture follows. Days are therefore processed oldest first, since
 * "did this change" is meaningless out of order.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const NEW_ONLY = args.includes('--new-only');

/**
 * A flag's value, refusing the two ways this quietly went wrong.
 *
 * `--days abc` made Number() return NaN, and `age <= NaN` is false, so the loader sampled
 * zero dates, did all its setup, announced "0 rows would be written" and exited 0. A typo
 * looked exactly like a finished run. `--days` with nothing after it was worse: it swallowed
 * the next flag as its value and did the same thing.
 *
 * This is a script that exists to be run once, before a mirror that is already withdrawn
 * disappears for good. A silent no-op is the most expensive bug it could have.
 */
function flagValue(name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`   ${name} needs a value.`);
    process.exit(2);
  }
  return value;
}

const rawDays = flagValue('--days');
const DAYS = rawDays === null ? 90 : Number(rawDays);
if (!Number.isInteger(DAYS) || DAYS < 1) {
  console.error(`   --days wants a whole number of days, not ${JSON.stringify(rawDays)}.`);
  process.exit(2);
}

const CACHE = flagValue('--cache') ?? os.tmpdir();
fs.mkdirSync(CACHE, { recursive: true });
const SOURCE_ID = 1;
const REPO = 'landonrroy/pokefolio-data';
const UA = { 'User-Agent': 'PokeMans/1.0 (collection tracker; contact rjohnson@utsec.net)' };

const env = (f) => Object.fromEntries(
  fs.readFileSync(f, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const e = { ...env('client/.env.local'), ...env('supabase/.env') };
const db = createClient(e.VITE_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/**
 * Which dates to load, following the retention policy.
 *
 *     0-7 days      every day
 *     8-30 days     Mondays and Thursdays
 *     31-365 days   Mondays
 *     366+ days     one a month
 *
 * Sampling as we load rather than loading everything and thinning afterwards is the
 * difference between writing millions of rows to delete most of them and writing only what
 * is kept. It must agree exactly with thin_price_history, or the nightly job would spend
 * every run deleting what the loader had just put in.
 *
 * Weekdays rather than intervals because they are stable: "every third day" depends on
 * where counting began, so the same date could be kept this month and dropped the next,
 * while a Monday is a Monday whatever came before it.
 */
const APP_TIMEZONE = 'America/Denver';

/** Today where the collection is, matching app_today() in Postgres. */
function localToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function sampledDates(days) {
  const out = [];
  // Counted back from the local day, not the UTC one. The thinning works in local days, and
  // a loader counting in UTC would sample a different set for six hours of every day --
  // writing rows the nightly job would then delete.
  const today = new Date(localToday() + 'T00:00:00Z');
  for (let age = 1; age <= days; age++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - age);
    const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();   // 1 Monday … 7 Sunday
    // Beyond a year, the first Monday of each month. Postgres keeps the newest point in each
    // calendar month, and over a long run of Mondays that is the last one; the loader cannot
    // know which Monday will end up last, so it takes the first and lets the nightly job
    // settle it. Either way one point per month survives, which is what both agree on.
    const keep = age <= 7 ? true
      : age <= 30 ? (isoDow === 1 || isoDow === 4)
      : age <= 365 ? isoDow === 1
      : isoDow === 1 && d.getUTCDate() <= 7;
    if (keep) out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse();   // oldest first: "changed since last time" needs chronological order
}

/**
 * Walks a gzipped tar in memory, yielding each regular file.
 *
 * Tar is 512-byte headers followed by file data padded to the next 512 boundary: the name
 * sits at offset 0, the size as octal at 124, and the type flag at 156 where '0' (or NUL,
 * from older writers) means a regular file. Two zero blocks end the archive.
 */
function* readTarGz(gz) {
  const buf = zlib.gunzipSync(gz);
  for (let off = 0; off + 512 <= buf.length;) {
    const name = buf.toString('utf8', off, off + 100).replace(/\0.*$/, '');
    if (!name) break;                                   // end-of-archive padding
    const size = parseInt(buf.toString('ascii', off + 124, off + 136).replace(/\0.*$/, '').trim(), 8) || 0;
    const type = String.fromCharCode(buf[off + 156]);
    const start = off + 512;
    if (type === '0' || type === '\0') yield { name, data: buf.subarray(start, start + size) };
    off = start + Math.ceil(size / 512) * 512;
  }
}

/**
 * One year of the mirror's files.
 *
 * Throws rather than returning nothing. An unauthenticated GitHub allows 60 requests an
 * hour, and a refusal used to come back as an empty list -- indistinguishable from a year
 * the mirror does not hold. Every date then read as "not in the mirror" and the run finished
 * successfully having loaded nothing, which is the same silent success the day validation
 * above exists to prevent.
 */
async function listArchive(year) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/data/${year}`, { headers: UA });
  if (res.status === 404) return [];                 // a year the mirror genuinely lacks
  if (!res.ok) {
    const hint = res.status === 403 || res.status === 429
      ? ' (GitHub allows 60 requests an hour unauthenticated; try again later)'
      : '';
    throw new Error(`could not list ${year} in the mirror: HTTP ${res.status}${hint}`);
  }
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}

/** Pulls one day's tarball and returns productId|subType -> {market, low}. */
async function fetchDay(file, local, index) {
  const entry = index.get(file);
  if (!entry) return false;
  const res = await fetch(entry.download_url, { headers: UA });
  if (!res.ok) return false;
  // Written to a neighbouring name and moved into place, so an interrupted download cannot
  // leave a half file wearing the name of a whole one.
  const partial = `${local}.part`;
  fs.writeFileSync(partial, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(partial, local);
  return true;
}

/**
 * Pulls one day's tarball and returns productId|subType -> {market, low}.
 *
 * A cached archive that is not readable is deleted and fetched once more rather than
 * throwing. A download interrupted partway used to leave a truncated file in the cache, and
 * because the cache is only ever checked for existence, that file was then read on every
 * later run: gunzip threw Z_BUF_ERROR from inside a generator, outside any try, and killed
 * the whole backfill at the same date every time. The only way out was knowing to delete a
 * file in a temp directory.
 */
async function loadDay(date, index) {
  const file = `prices-${date}.tar.gz`;
  const local = path.join(CACHE, file);
  if (!fs.existsSync(local) && !(await fetchDay(file, local, index))) return null;

  // Read in memory rather than shelling out to tar. The system tar differs between
  // platforms -- the Windows one rejected these paths outright -- and a day's archive is a
  // megabyte, so there is nothing to gain from touching the disk twice.
  const readEntries = () => {
    const prices = new Map();
    for (const entry of readTarGz(fs.readFileSync(local))) {
      if (!entry.name.endsWith('/prices')) continue;
      try {
        for (const r of JSON.parse(entry.data.toString('utf8')).results ?? []) {
          if (r.marketPrice == null && r.lowPrice == null) continue;
          prices.set(`${r.productId}|${r.subTypeName}`, {
            market: r.marketPrice ?? null, low: r.lowPrice ?? null,
          });
        }
      } catch { /* one bad group file loses that set for that day, not the run */ }
    }
    return prices;
  };

  try {
    return readEntries();
  } catch (err) {
    console.log(`   ${date}  cached copy unreadable (${err.code ?? err.message}); fetching again`);
    fs.rmSync(local, { force: true });
    if (!(await fetchDay(file, local, index))) return null;
    try {
      return readEntries();
    } catch (second) {
      console.error(`   ${date}  still unreadable after a fresh download: ${second.message}`);
      fs.rmSync(local, { force: true });
      return null;
    }
  }
}

// ---------------------------------------------------------------- run

const dates = sampledDates(DAYS);
console.log(`   ${DAYS} days back → ${dates.length} dates after the retention bands`);
console.log(`   ${dates[0]} … ${dates[dates.length - 1]}`);

const years = [...new Set(dates.map((d) => d.slice(0, 4)))];
const index = new Map();
for (const y of years) for (const f of await listArchive(y)) index.set(f.name, f);
console.log(`   mirror holds ${index.size} files across ${years.join(', ')}`);

// Which printings to load for, when only the late arrivals are wanted. Asked of Postgres,
// because answering it here would mean paging 2.8 million history rows a thousand at a time.
let wanted = null;
if (NEW_ONLY) {
  const { data, error } = await db.rpc('printings_needing_backfill', { p_source_id: SOURCE_ID });
  if (error) throw new Error(`printings_needing_backfill: ${error.message}`);
  wanted = new Set(data.map((r) => `${r.card_ref}|${r.variant_position}`));
  console.log(`   ${wanted.size.toLocaleString()} printings have no history to speak of`);
  if (!wanted.size) {
    console.log('   nothing to backfill.');
    process.exit(0);
  }
}

// The mapping, so only cards we carry are loaded at all.
//
// One upstream product can serve several of our printings -- a card whose only published
// price is "Normal" is the match for both its normal and its metal printing, and a few
// products are shared across sets. So this is product -> list, not product -> one: keying it
// one-to-one quietly dropped 3,704 printings, which would have shown up as cards that simply
// never had a price and no error anywhere to say why.
const map = new Map();
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('price_map')
    .select('card_ref,variant_position,external_id,sub_type')
    .eq('source_id', SOURCE_ID).range(from, from + 999);
  if (error) throw new Error(error.message);
  for (const m of data) {
    if (wanted && !wanted.has(`${m.card_ref}|${m.variant_position}`)) continue;
    const k = `${m.external_id}|${m.sub_type}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(m);
  }
  if (data.length < 1000) break;
}
const mappedPrintings = [...map.values()].reduce((a, v) => a + v.length, 0);
console.log(`   ${mappedPrintings.toLocaleString()} printings across ${map.size.toLocaleString()} products`);
if (!mappedPrintings) {
  console.log('   nothing to load.');
  process.exit(0);
}

const lastSeen = new Map();   // card|variant -> "market|low" as last written
let totalRows = 0, missingDays = 0;

for (const date of dates) {
  const prices = await loadDay(date, index);
  if (!prices) { missingDays++; console.log(`   ${date}  (not in the mirror)`); continue; }

  const rows = [];
  for (const [key, value] of prices) {
    for (const m of map.get(key) ?? []) {
      const id = `${m.card_ref}|${m.variant_position}`;
      const signature = `${value.market}|${value.low}`;
      if (lastSeen.get(id) === signature) continue;   // unchanged since the last sampled day
      lastSeen.set(id, signature);
      rows.push({
        card_ref: m.card_ref,
        variant_position: m.variant_position,
        source_id: SOURCE_ID,
        captured_on: date,
        market: value.market,
        low: value.low,
      });
    }
  }

  totalRows += rows.length;
  console.log(`   ${date}  ${String(rows.length).padStart(6)} changed  (${prices.size.toLocaleString()} published)`);

  if (APPLY && rows.length) {
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await db.from('price_point')
        .upsert(rows.slice(i, i + 1000), { onConflict: 'card_ref,variant_position,source_id,captured_on' });
      if (error) { console.error('   failed:', error.message); process.exit(1); }
    }
  }
}

console.log('');
console.log(`   ${totalRows.toLocaleString()} rows${APPLY ? ' written' : ' would be written'}`);
if (missingDays) console.log(`   ${missingDays} dates were not in the mirror`);
if (!APPLY) console.log('   dry run — re-run with --apply to write them.');
