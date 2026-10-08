/**
 * Refreshes the shared catalogue from upstream, straight into Supabase.
 *
 *   node supabase/scripts/catalogue/sync.mjs                 everything
 *   node supabase/scripts/catalogue/sync.mjs --only=cards    one job
 *   node supabase/scripts/catalogue/sync.mjs --start=1 --end=151
 *
 * Only shared reference data: every Pokémon and every card that exists. Nothing personal --
 * no collections, no want lists, no settings. Those belong to a user, and this runs with the
 * service key, which has no user.
 *
 * It replaces a pipeline that went through a local SQLite file and a second import step. The
 * file was a staging area for a server that no longer exists, and keeping it meant the
 * catalogue had two homes that could disagree.
 *
 * Re-runnable. Every table is upserted on its key, so running it twice changes nothing and
 * running it after a failure finishes the job.
 *
 * Order matters once: cards reference Pokémon, and the TCGdex pass enriches cards that the
 * card job must already have written.
 */
import { syncPokeApi } from './pokeapi.mjs';
import { syncTcgCards } from './tcgcards.mjs';
import { syncTcgdexEnrichment } from './tcgdex.mjs';
import { syncLogos } from './logos.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const only = args.only ? String(args.only).split(',') : null;
const wants = (job) => !only || only.includes(job);

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;

if (wants('pokemon')) {
  console.log('   Pokémon, from PokéAPI…');
  const r = await syncPokeApi({
    start: args.start ? Number(args.start) : undefined,
    end: args.end ? Number(args.end) : undefined,
    onProgress: (p) => {
      if (p.phase === 'species' && p.synced % 100 === 0) {
        process.stdout.write(`\r      ${p.synced} of about ${p.total}…   `);
      }
    },
  });
  process.stdout.write('\r');
  console.log(`      ${r.synced} Pokémon, ${r.evolutions} evolution edges  (${elapsed()})`);
  if (r.failures.length) console.log(`      ${r.failures.length} species failed: ${r.failures.slice(0, 10).join(', ')}`);
}

if (wants('cards')) {
  console.log('   cards, from pokemon-tcg-data…');
  const r = await syncTcgCards({
    onProgress: (p) => process.stdout.write(`\r      set ${p.page} of ${p.totalPages}, ${p.synced} cards…   `),
  });
  process.stdout.write('\r');
  console.log(`      ${r.synced} cards, ${r.cardsLinked} linked to a Pokémon  (${elapsed()})`);
  if (r.recoveredByName) console.log(`      ${r.recoveredByName} had no dex number and were linked by name`);
  if (r.failedSets.length) console.log(`      ${r.failedSets.length} set(s) failed — re-run to fill gaps`);
}

if (wants('printings')) {
  console.log('   images and printings, from TCGdex…');
  const r = await syncTcgdexEnrichment({
    onProgress: (p) => process.stdout.write(`\r      set ${p.page} of ${p.totalPages}…   `),
  });
  process.stdout.write('\r');
  console.log(`      ${r.setsMatched} of ${r.setsTotal} sets matched, ${r.imagesSet} images, ${r.variantRows} printings  (${elapsed()})`);
}

if (wants('logos')) {
  console.log('   set and series logos, onto the laptop…');
  const r = await syncLogos({ onProgress: (p) => process.stdout.write(`\r      ${p.done} of ${p.total}…   `) });
  process.stdout.write('\r');
  console.log(`      ${r.written} downloaded, ${r.skipped} already held, ${r.failed} failed — ${(r.bytes / 1048576).toFixed(1)} MB  (${elapsed()})`);
}

console.log(`   done in ${elapsed()}`);
