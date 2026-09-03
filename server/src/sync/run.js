import 'dotenv/config';
import { getTcgApiKey } from '../routes/settings.js';
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

  if (!getTcgApiKey()) {
    console.log(
      'No TCG API key saved — skipping card sync. Add one in Settings (in the app) or set ' +
        'TCG_API_KEY in server/.env. Get a free key at https://dev.pokemontcg.io/',
    );
    return;
  }

  console.log('Syncing Pokemon TCG card images...');
  const tcgResult = await runTcgSync();
  console.log(`TCG sync done: ${tcgResult.cardCount} cards across ${tcgResult.synced} pokemon.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
  });
