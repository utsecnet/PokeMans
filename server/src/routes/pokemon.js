import { Router } from 'express';
import { localArtwork, localSprite, localiseCards, localiseSprites } from '../lib/artwork.js';
import { all, get } from '../db/index.js';
import { attachCollection } from '../lib/collectionInfo.js';
import { typesByPokemon } from '../lib/pokemonTypes.js';
import { buildOrderByClause, parseSortChain } from '../lib/sortChain.js';

export const pokemonRouter = Router();

function findChainRoot(pokemonId) {
  let current = pokemonId;
  const seen = new Set();
  while (!seen.has(current)) {
    seen.add(current);
    const parent = get('SELECT pokemon_id as id FROM evolutions WHERE evolves_into_id = @id', {
      id: current,
    });
    if (!parent) return current;
    current = parent.id;
  }
  return current;
}

function buildEvolutionNode(pokemonId, transition = {}, seen = new Set()) {
  if (seen.has(pokemonId)) return null;
  seen.add(pokemonId);

  const p = get(
    `SELECT id, name, sprite_url as spriteUrl, artwork_url as artworkUrl
     FROM pokemon WHERE id = @id`,
    { id: pokemonId },
  );
  if (!p) return null;

  const types = all(
    `SELECT t.name FROM pokemon_types pt JOIN types t ON t.id = pt.type_id
     WHERE pt.pokemon_id = @id ORDER BY pt.slot`,
    { id: pokemonId },
  ).map((r) => r.name);

  const edges = all(
    `SELECT evolves_into_id as toId, trigger, min_level as minLevel, item
     FROM evolutions WHERE pokemon_id = @id ORDER BY evolves_into_id`,
    { id: pokemonId },
  );

  return {
    id: p.id,
    name: p.name,
    spriteUrl: localSprite(p.spriteUrl),
    artworkUrl: localArtwork(p.artworkUrl),
    types,
    trigger: transition.trigger ?? null,
    minLevel: transition.minLevel ?? null,
    item: transition.item ?? null,
    children: edges
      .map((e) => buildEvolutionNode(e.toId, e, seen))
      .filter((n) => n !== null),
  };
}

export function buildEvolutionChain(pokemonId) {
  const rootId = findChainRoot(pokemonId);
  return buildEvolutionNode(rootId);
}

const SORT_COLUMNS = {
  dex: 'p.national_dex_number',
  name: 'p.name',
  hp: 's.hp',
  attack: 's.attack',
  defense: 's.defense',
  specialAttack: 's.special_attack',
  specialDefense: 's.special_defense',
  speed: 's.speed',
  height: 'p.height',
  weight: 'p.weight',
  baseExperience: 'p.base_experience',
  // Counted inline so the list can be ordered by it. The per-page count attached to the
  // response can't be sorted on — ordering has to happen before the page is cut. Each
  // evaluation is an index lookup on tcg_card_pokemon(pokemon_id), which over ~1,000
  // default varieties measures around 10ms.
  cardCount: '(SELECT COUNT(DISTINCT tcp.card_id) FROM tcg_card_pokemon tcp WHERE tcp.pokemon_id = p.id)',
};

const DEFAULT_SORT_CHAIN = [{ field: 'dex', dir: 'ASC' }];
const SORT_TIEBREAKERS = ['p.national_dex_number ASC'];

const STAT_KEYS = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];
const STAT_COLUMNS = {
  hp: 's.hp',
  attack: 's.attack',
  defense: 's.defense',
  specialAttack: 's.special_attack',
  specialDefense: 's.special_defense',
  speed: 's.speed',
};

function attachTypes(rows) {
  if (rows.length === 0) return rows;
  const byPokemon = typesByPokemon(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, types: byPokemon.get(r.id) ?? [] }));
}

// How many TCG cards exist for each Pokémon on this page. Counted only for the rows being
// returned (~60) rather than the whole link table, and deliberately a total across every
// expansion — it answers "how much card art exists for this Pokémon", so it shouldn't
// shrink when the sidebar's expansion filter narrows the view.
function attachCardCounts(rows) {
  if (rows.length === 0) return rows;
  const params = {};
  const keys = rows.map((r, i) => {
    params[`p${i}`] = r.id;
    return `@p${i}`;
  });
  const counts = new Map(
    all(
      `SELECT pokemon_id as pokemonId, COUNT(DISTINCT card_id) as cardCount
       FROM tcg_card_pokemon WHERE pokemon_id IN (${keys.join(', ')})
       GROUP BY pokemon_id`,
      params,
    ).map((r) => [r.pokemonId, r.cardCount]),
  );
  return rows.map((r) => ({ ...r, cardCount: counts.get(r.id) ?? 0 }));
}

function csvParam(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function addInClause(where, params, expr, values, prefix) {
  if (values.length === 0) return;
  const keys = values.map((v, i) => `${prefix}${i}`);
  keys.forEach((k, i) => {
    params[k] = values[i];
  });
  where.push(`${expr} IN (${keys.map((k) => `@${k}`).join(', ')})`);
}

function addRangeClauses(where, params, column, key, minRaw, maxRaw) {
  if (minRaw !== undefined && minRaw !== '') {
    where.push(`${column} >= @min${key}`);
    params[`min${key}`] = Number(minRaw);
  }
  if (maxRaw !== undefined && maxRaw !== '') {
    where.push(`${column} <= @max${key}`);
    params[`max${key}`] = Number(maxRaw);
  }
}

pokemonRouter.get('/', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  // 25000 accommodates the "fetch everything, filter client-side" bulk request the
  // advanced search bar issues once a query uses operators it can't push down to SQL.
  const pageSize = Math.min(25000, Math.max(1, Number(req.query.pageSize) || 60));
  const offset = (page - 1) * pageSize;

  const search = req.query.search ? `%${String(req.query.search).toLowerCase()}%` : null;
  const types = csvParam(req.query.types);
  const typeMode = req.query.typeMode === 'all' ? 'all' : 'any';
  const generations = csvParam(req.query.generations);
  const abilities = csvParam(req.query.abilities);
  const expansions = csvParam(req.query.expansions);

  // `sort` is an ordered chain, matching the card endpoint. sortBy/sortDir are still
  // honoured when no chain is given, so an older client keeps working.
  const legacyChain = SORT_COLUMNS[req.query.sortBy]
    ? [{ field: req.query.sortBy, dir: req.query.sortDir === 'desc' ? 'DESC' : 'ASC' }]
    : DEFAULT_SORT_CHAIN;
  const sortChain = parseSortChain(req.query.sort, SORT_COLUMNS, legacyChain);

  const where = ['p.is_default_variety = 1'];
  const params = { limit: pageSize, offset };

  if (search) {
    where.push('LOWER(p.name) LIKE @search');
    params.search = search;
  }

  addInClause(where, params, 'p.generation', generations, 'gen');

  if (types.length > 0) {
    if (typeMode === 'all') {
      const keys = types.map((_, i) => `type${i}`);
      keys.forEach((k, i) => {
        params[k] = types[i];
      });
      where.push(
        `p.id IN (
           SELECT pt.pokemon_id FROM pokemon_types pt JOIN types t ON t.id = pt.type_id
           WHERE t.name IN (${keys.map((k) => `@${k}`).join(', ')})
           GROUP BY pt.pokemon_id HAVING COUNT(DISTINCT t.name) = @typeCount
         )`,
      );
      params.typeCount = types.length;
    } else {
      const keys = types.map((_, i) => `type${i}`);
      keys.forEach((k, i) => {
        params[k] = types[i];
      });
      where.push(
        `p.id IN (
           SELECT pt.pokemon_id FROM pokemon_types pt JOIN types t ON t.id = pt.type_id
           WHERE t.name IN (${keys.map((k) => `@${k}`).join(', ')})
         )`,
      );
    }
  }

  if (abilities.length > 0) {
    const keys = abilities.map((_, i) => `ability${i}`);
    keys.forEach((k, i) => {
      params[k] = abilities[i];
    });
    where.push(
      `p.id IN (
         SELECT pa.pokemon_id FROM pokemon_abilities pa JOIN abilities a ON a.id = pa.ability_id
         WHERE a.name IN (${keys.map((k) => `@${k}`).join(', ')})
       )`,
    );
  }

  if (expansions.length > 0) {
    const keys = expansions.map((_, i) => `expansion${i}`);
    keys.forEach((k, i) => {
      params[k] = expansions[i];
    });
    where.push(
      `p.id IN (
         SELECT DISTINCT tcp.pokemon_id FROM tcg_card_pokemon tcp JOIN tcg_cards c ON c.id = tcp.card_id
         WHERE c.set_id IN (${keys.map((k) => `@${k}`).join(', ')})
       )`,
    );
  }

  for (const key of STAT_KEYS) {
    addRangeClauses(where, params, STAT_COLUMNS[key], key, req.query[`min${cap(key)}`], req.query[`max${cap(key)}`]);
  }
  addRangeClauses(where, params, 'p.height', 'Height', req.query.minHeight, req.query.maxHeight);
  addRangeClauses(where, params, 'p.weight', 'Weight', req.query.minWeight, req.query.maxWeight);
  addRangeClauses(
    where,
    params,
    'p.base_experience',
    'BaseExperience',
    req.query.minBaseExperience,
    req.query.maxBaseExperience,
  );

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const items = all(
    `SELECT p.id, p.national_dex_number as nationalDexNumber, p.name, p.generation,
            p.sprite_url as spriteUrl, p.artwork_url as artworkUrl,
            p.height, p.weight, p.base_experience as baseExperience,
            s.hp, s.attack, s.defense, s.special_attack as specialAttack,
            s.special_defense as specialDefense, s.speed
     FROM pokemon p
     LEFT JOIN stats s ON s.pokemon_id = p.id
     ${whereClause}
     ORDER BY ${buildOrderByClause(sortChain, SORT_COLUMNS, SORT_TIEBREAKERS)}
     LIMIT @limit OFFSET @offset`,
    params,
  );

  const { limit: _limit, offset: _offset, ...countParams } = params;
  const { total } = get(
    `SELECT COUNT(*) as total
     FROM pokemon p
     LEFT JOIN stats s ON s.pokemon_id = p.id
     ${whereClause}`,
    countParams,
  );

  res.json({ items: localiseSprites(attachCardCounts(attachTypes(items))), total, page, pageSize });
});

function cap(key) {
  return key[0].toUpperCase() + key.slice(1);
}

pokemonRouter.get('/meta/generations', (_req, res) => {
  // Sorting the string "generation-ix" alphabetically puts it before "generation-v" (i < v),
  // which reads as a stray duplicate next to "generation-iv". Order chronologically instead,
  // by the lowest dex number in each generation.
  const rows = all(
    `SELECT generation, MIN(national_dex_number) as firstDex
     FROM pokemon WHERE generation IS NOT NULL AND is_default_variety = 1
     GROUP BY generation ORDER BY firstDex`,
  );
  res.json(rows.map((r) => r.generation));
});

pokemonRouter.get('/meta/types', (_req, res) => {
  const rows = all('SELECT name FROM types ORDER BY name');
  res.json(rows.map((r) => r.name));
});

pokemonRouter.get('/meta/abilities', (_req, res) => {
  const rows = all('SELECT name FROM abilities ORDER BY name');
  res.json(rows.map((r) => r.name));
});

pokemonRouter.get('/meta/expansions', (_req, res) => {
  const rows = all(
    `SELECT c.set_id as id, c.set_name as name, c.series, MIN(c.release_date) as releaseDate,
            s.symbol_url as symbolUrl
     FROM tcg_cards c
     LEFT JOIN tcg_sets s ON s.id = c.set_id
     WHERE c.set_id IS NOT NULL
     GROUP BY c.set_id, c.set_name, c.series, s.symbol_url
     ORDER BY releaseDate, name`,
  );
  res.json(rows);
});

pokemonRouter.get('/meta/ranges', (_req, res) => {
  const row = get(
    `SELECT MIN(p.height) as minHeight, MAX(p.height) as maxHeight,
            MIN(p.weight) as minWeight, MAX(p.weight) as maxWeight,
            MIN(p.base_experience) as minBaseExperience, MAX(p.base_experience) as maxBaseExperience,
            MIN(s.hp) as minHp, MAX(s.hp) as maxHp,
            MIN(s.attack) as minAttack, MAX(s.attack) as maxAttack,
            MIN(s.defense) as minDefense, MAX(s.defense) as maxDefense,
            MIN(s.special_attack) as minSpecialAttack, MAX(s.special_attack) as maxSpecialAttack,
            MIN(s.special_defense) as minSpecialDefense, MAX(s.special_defense) as maxSpecialDefense,
            MIN(s.speed) as minSpeed, MAX(s.speed) as maxSpeed
     FROM pokemon p LEFT JOIN stats s ON s.pokemon_id = p.id
     WHERE p.is_default_variety = 1`,
  );
  res.json(row);
});

function buildVariantSummary(variantId) {
  const p = get(
    `SELECT id, name, variant_label as variantLabel,
            sprite_url as spriteUrl, artwork_url as artworkUrl
     FROM pokemon WHERE id = @id`,
    { id: variantId },
  );
  if (!p) return null;
  const types = all(
    `SELECT t.name FROM pokemon_types pt JOIN types t ON t.id = pt.type_id
     WHERE pt.pokemon_id = @id ORDER BY pt.slot`,
    { id: variantId },
  ).map((r) => r.name);
  return {
    ...p,
    spriteUrl: localSprite(p.spriteUrl),
    artworkUrl: localArtwork(p.artworkUrl),
    types,
    evolutionChain: buildEvolutionChain(variantId),
  };
}

pokemonRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const pokemon = get(
    `SELECT id, national_dex_number as nationalDexNumber, name, generation, height, weight,
            base_experience as baseExperience, flavor_text as flavorText,
            sprite_url as spriteUrl, artwork_url as artworkUrl,
            is_default_variety as isDefaultVariety, variant_label as variantLabel
     FROM pokemon WHERE id = @id`,
    { id },
  );

  if (!pokemon) {
    res.status(404).json({ error: 'Pokemon not found' });
    return;
  }

  pokemon.spriteUrl = localSprite(pokemon.spriteUrl);
  pokemon.artworkUrl = localArtwork(pokemon.artworkUrl);

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

  const evolutionChain = buildEvolutionChain(id);

  const tcgCards = attachCollection(
    localiseCards(
      all(
        `SELECT c.id, c.name, c.number, c.set_id as setId, c.set_name as setName, c.series, c.rarity,
                c.release_date as releaseDate,
                COALESCE(c.image_webp, c.image_small) as imageSmall, c.image_large as imageLarge
         FROM tcg_card_pokemon tcp JOIN tcg_cards c ON c.id = tcp.card_id
         WHERE tcp.pokemon_id = @id
         ORDER BY c.release_date, c.set_name, c.number`,
        { id },
      ),
    ),
  );

  const variants = all(
    `SELECT id FROM pokemon
     WHERE national_dex_number = @dex AND id != @id
     ORDER BY is_default_variety DESC, variant_label`,
    { dex: pokemon.nationalDexNumber, id },
  )
    .map((r) => buildVariantSummary(r.id))
    .filter((v) => v !== null);

  res.json({
    ...pokemon,
    isDefaultVariety: !!pokemon.isDefaultVariety,
    types,
    abilities,
    stats,
    evolutionChain,
    tcgCards,
    variants,
  });
});
