import { all, upsert } from '../db/index.js';
import { fetchJson, sleep } from './http.js';

const BASE = 'https://api.pokemontcg.io/v2';
const REQUEST_DELAY_MS = 150;

function baseName(name) {
  const withoutSuffix = name.split('-')[0];
  return withoutSuffix
    .split(' ')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

async function fetchCardsForName(name, apiKey) {
  const query = `name:"${name}"`;
  const url = `${BASE}/cards?q=${encodeURIComponent(query)}&pageSize=60`;
  const json = await fetchJson(url, {
    headers: apiKey ? { 'X-Api-Key': apiKey } : {},
  });
  return json.data ?? [];
}

export async function syncTcgCards({ apiKey, onProgress } = {}) {
  if (!apiKey) {
    throw new Error(
      'TCG_API_KEY is not set. Get a free key at https://dev.pokemontcg.io/ and add it to server/.env',
    );
  }

  const pokemonRows = all('SELECT id, name FROM pokemon ORDER BY id');
  let synced = 0;
  let cardCount = 0;

  for (const row of pokemonRows) {
    try {
      const cards = await fetchCardsForName(baseName(row.name), apiKey);
      for (const card of cards) {
        upsert(
          'tcg_cards',
          {
            id: card.id,
            pokemon_id: row.id,
            name: card.name,
            set_name: card.set?.name ?? null,
            series: card.set?.series ?? null,
            rarity: card.rarity ?? null,
            image_small: card.images?.small ?? null,
            image_large: card.images?.large ?? null,
          },
          ['id'],
        );
        cardCount++;
      }
      synced++;
      onProgress?.({ pokemon: row.name, cards: cards.length, synced, total: pokemonRows.length });
    } catch (err) {
      console.error(`Failed to sync TCG cards for ${row.name}:`, err.message);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  return { synced, cardCount, total: pokemonRows.length };
}
