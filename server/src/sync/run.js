import 'dotenv/config';
import { runPokeApiSync, runTcgSync } from './runner.js';

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    args[key] = value ?? true;
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const start = args.start ? Number(args.start) : undefined;
  const end = args.end ? Number(args.end) : undefined;
  const skipTcg = args['skip-tcg'] === true || args['skip-tcg'] === 'true';

  console.log(`Syncing PokeAPI species ${start ?? 1}${end ? `-${end}` : '-*'}...`);
  const pokeResult = await runPokeApiSync({ start, end });
  console.log(`PokeAPI sync done: ${pokeResult.synced}/${pokeResult.total} species.`);

  if (skipTcg) {
    console.log('Skipping TCG card sync (--skip-tcg).');
    return;
  }

  console.log('Syncing Pokemon TCG card images (full catalog)...');
  const tcgResult = await runTcgSync();
  console.log(
    `TCG sync done: ${tcgResult.synced} cards stored, ${tcgResult.cardsLinked} of them linked to a Pokemon ` +
      `(the rest are Trainer/Energy cards, which have no dex number). Scanned ${tcgResult.cardsSeen} cards.`,
  );
  if (tcgResult.recoveredByName) {
    console.log(
      `${tcgResult.recoveredByName} card(s) had no dex number in the data and were linked by name instead.`,
    );
  }
  if (tcgResult.failedPages?.length) {
    console.log(
      `${tcgResult.failedPages.length} set(s) failed and were skipped — re-run the sync to fill gaps.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
  });
