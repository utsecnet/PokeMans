import { Router } from 'express';
import { all, get } from '../db/index.js';

export const pokemonRouter = Router();

function attachTypes(rows) {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map((_, i) => `@id${i}`).join(', ');
  const params = Object.fromEntries(ids.map((id, i) => [`id${i}`, id]));
  const typeRows = all(
    `SELECT pt.pokemon_id as pokemonId, t.name
     FROM pokemon_types pt JOIN types t ON t.id = pt.type_id
     WHERE pt.pokemon_id IN (${placeholders})
     ORDER BY pt.pokemon_id, pt.slot`,
    params,
  );
  const byPokemon = new Map();
  for (const row of typeRows) {
    if (!byPokemon.has(row.pokemonId)) byPokemon.set(row.pokemonId, []);
    byPokemon.get(row.pokemonId).push(row.name);
  }
  return rows.map((r) => ({ ...r, types: byPokemon.get(r.id) ?? [] }));
}

pokemonRouter.get('/', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 60));
  const offset = (page - 1) * pageSize;

  const search = req.query.search ? `%${String(req.query.search).toLowerCase()}%` : null;
  const type = req.query.type ? String(req.query.type) : null;
  const generation = req.query.generation ? String(req.query.generation) : null;

  const where = [];
  const params = { limit: pageSize, offset };

  if (search) {
    where.push('LOWER(p.name) LIKE @search');
    params.search = search;
  }
  if (generation) {
    where.push('p.generation = @generation');
    params.generation = generation;
  }
  if (type) {
    where.push(
      'p.id IN (SELECT pt.pokemon_id FROM pokemon_types pt JOIN types t ON t.id = pt.type_id WHERE t.name = @type)',
    );
    params.type = type;
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const items = all(
    `SELECT p.id, p.national_dex_number as nationalDexNumber, p.name, p.generation,
            p.sprite_url as spriteUrl, p.artwork_url as artworkUrl
     FROM pokemon p
     ${whereClause}
     ORDER BY p.national_dex_number ASC
     LIMIT @limit OFFSET @offset`,
    params,
  );

  const { limit: _limit, offset: _offset, ...countParams } = params;
  const { total } = get(
    `SELECT COUNT(*) as total FROM pokemon p ${whereClause}`,
    countParams,
  );

  res.json({ items: attachTypes(items), total, page, pageSize });
});

pokemonRouter.get('/meta/generations', (_req, res) => {
  const rows = all(
    'SELECT DISTINCT generation FROM pokemon WHERE generation IS NOT NULL ORDER BY generation',
  );
  res.json(rows.map((r) => r.generation));
});

pokemonRouter.get('/meta/types', (_req, res) => {
  const rows = all('SELECT name FROM types ORDER BY name');
  res.json(rows.map((r) => r.name));
});

pokemonRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const pokemon = get(
    `SELECT id, national_dex_number as nationalDexNumber, name, generation, height, weight,
            base_experience as baseExperience, flavor_text as flavorText,
            sprite_url as spriteUrl, artwork_url as artworkUrl
     FROM pokemon WHERE id = @id`,
    { id },
  );

  if (!pokemon) {
    res.status(404).json({ error: 'Pokemon not found' });
    return;
  }

  const types = all(
    `SELECT t.name FROM pokemon_types pt JOIN types t ON t.id = pt.type_id
     WHERE pt.pokemon_id = @id ORDER BY pt.slot`,
    { id },
  ).map((r) => r.name);

  const abilities = all(
    `SELECT a.name, pa.is_hidden as isHidden FROM pokemon_abilities pa
     JOIN abilities a ON a.id = pa.ability_id
     WHERE pa.pokemon_id = @id ORDER BY pa.slot`,
    { id },
  ).map((r) => ({ name: r.name, isHidden: !!r.isHidden }));

  const stats = get(
    `SELECT hp, attack, defense, special_attack as specialAttack,
            special_defense as specialDefense, speed
     FROM stats WHERE pokemon_id = @id`,
    { id },
  );

  const evolvesFrom = all(
    `SELECT p.id, p.name, p.sprite_url as spriteUrl, e.trigger, e.min_level as minLevel, e.item
     FROM evolutions e JOIN pokemon p ON p.id = e.pokemon_id
     WHERE e.evolves_into_id = @id`,
    { id },
  );

  const evolvesTo = all(
    `SELECT p.id, p.name, p.sprite_url as spriteUrl, e.trigger, e.min_level as minLevel, e.item
     FROM evolutions e JOIN pokemon p ON p.id = e.evolves_into_id
     WHERE e.pokemon_id = @id`,
    { id },
  );

  const tcgCards = all(
    `SELECT id, name, set_name as setName, series, rarity,
            image_small as imageSmall, image_large as imageLarge
     FROM tcg_cards WHERE pokemon_id = @id ORDER BY series, set_name`,
    { id },
  );

  res.json({ ...pokemon, types, abilities, stats, evolvesFrom, evolvesTo, tcgCards });
});
