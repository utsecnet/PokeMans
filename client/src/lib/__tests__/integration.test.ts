// Integration suite: exercises parseQuery/matchesQuery/isAdvancedQuery and the autocomplete
// logic (advancedSearchLogic.ts) together, the way the real search bar actually uses them —
// plus an explicit check of every worked example documented in SearchHelp.tsx, so the docs
// and the parser can never silently drift apart.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isAdvancedQuery, matchesQuery, parseQuery } from '../queryLanguage.ts';
import { applySuggestion, computeSuggestions, currentToken } from '../advancedSearchLogic.ts';
import { CARD_FIXTURE, POKEMON_FIXTURE, cardSchema, pokemonSchema } from './fixtures.ts';

function pokemonNames(query: string): string[] {
  const parsed = parseQuery(query);
  return POKEMON_FIXTURE.filter((p) => matchesQuery(parsed, p, pokemonSchema))
    .map((p) => p.name)
    .sort();
}

function cardIds(query: string): string[] {
  const parsed = parseQuery(query);
  return CARD_FIXTURE.filter((c) => matchesQuery(parsed, c, cardSchema))
    .map((c) => c.id)
    .sort();
}

// Simulates a user typing a query character-by-character, accepting the top suggestion
// after every accepted token, and returns the final query text plus every intermediate
// value produced along the way (each of which must remain parseable without throwing).
function simulateTyping(steps: Array<{ type: string } | { accept: true }>, schema: typeof pokemonSchema): {
  finalText: string;
  intermediates: string[];
} {
  let text = '';
  let cursor = 0;
  const intermediates: string[] = [];
  for (const step of steps) {
    if ('accept' in step) {
      const { start, text: token } = currentToken(text, cursor);
      const sugs = computeSuggestions(token, schema);
      if (sugs.length > 0) {
        const applied = applySuggestion(text, start, cursor, sugs[0]);
        text = applied.text;
        cursor = applied.cursor;
      }
    } else {
      text = text.slice(0, cursor) + step.type + text.slice(cursor);
      cursor += step.type.length;
    }
    intermediates.push(text);
    assert.doesNotThrow(() => parseQuery(text), `parseQuery threw on intermediate state: ${JSON.stringify(text)}`);
  }
  return { finalText: text, intermediates };
}

describe('simulated typing sessions', () => {
  test('typing "att" then accepting the field suggestion produces a valid field clause', () => {
    const { finalText } = simulateTyping(
      [{ type: 'a' }, { type: 't' }, { type: 't' }, { accept: true }],
      pokemonSchema,
    );
    assert.equal(finalText, 'attack:');
    // still a syntactically valid (if value-less) query afterward
    assert.doesNotThrow(() => parseQuery(finalText));
  });

  test('typing a field, accepting a value suggestion, then continuing with AND', () => {
    const { finalText } = simulateTyping(
      [
        { type: 't' },
        { type: 'y' },
        { type: 'p' },
        { type: 'e' },
        { type: ':' },
        { type: 'f' },
        { accept: true }, // -> "type:fire "
        { type: 'h' },
        { type: 'p' },
        { type: '>' },
        { type: '5' },
        { type: '0' },
      ],
      pokemonSchema,
    );
    assert.equal(finalText, 'type:fire hp>50');
    assert.deepEqual(pokemonNames(finalText), pokemonNames('type:fire AND hp>50'));
  });

  test('typing "!" then accepting a field suggestion produces a negated clause', () => {
    const { finalText } = simulateTyping(
      [{ type: '!' }, { type: 'a' }, { type: 't' }, { type: 't' }, { accept: true }],
      pokemonSchema,
    );
    assert.equal(finalText, '!attack:');
  });

  test('accepting with no matching suggestions leaves the text unchanged', () => {
    const { finalText } = simulateTyping(
      [{ type: 'z' }, { type: 'z' }, { type: 'z' }, { accept: true }],
      pokemonSchema,
    );
    assert.equal(finalText, 'zzz');
  });

  test('every intermediate state during a realistic session stays parseable', () => {
    const { intermediates } = simulateTyping(
      [
        { type: '(' },
        { type: 'g' },
        { type: 'e' },
        { type: 'n' },
        { accept: true },
        { type: '1' },
        { type: ' ' },
        { type: 'A' },
        { type: 'N' },
        { type: 'D' },
        { type: ' ' },
        { type: 't' },
        { type: 'y' },
        { type: 'p' },
        { accept: true },
      ],
      pokemonSchema,
    );
    assert.ok(intermediates.length > 0);
  });
});

describe('SearchHelp.tsx worked examples stay in sync with the parser', () => {
  // Every <Example query="..."> literal from client/src/pages/SearchHelp.tsx, replayed
  // against both schemas. Fixture data is a small hand-picked roster (not the full synced
  // dataset the docs describe), so most assertions check "parses cleanly and is classified
  // as advanced syntax" rather than exact result sets — the exceptions are examples whose
  // semantics are fully checkable against the fixture, which get real match assertions.
  const allExamples = [
    'name:char*',
    'name:*saur',
    'name:*chu*',
    'rarity:*rare*',
    '!type:water',
    'NOT type:water',
    'NOT owned:true',
    'type:fire hp>80',
    'type:fire OR type:water',
    'gen:1 OR gen:2 legendary',
    '(gen:1 AND type:fire) AND NOT name:charmander',
    '(type:fire OR type:water) AND gen:1',
    'NOT (type:fire OR type:water)',
    'hp>=100 speed>90',
    'height:1.5..2.5 type:dragon',
    'set:"Temporal Forces" rarity!=common',
    'owned:false rarity:common',
    'collection:"Charizard Deck"',
    'pikachu NOT collection:*',
  ];

  for (const query of allExamples) {
    test(`"${query}" parses and evaluates without throwing on both schemas`, () => {
      const parsed = parseQuery(query);
      assert.doesNotThrow(() => POKEMON_FIXTURE.forEach((p) => matchesQuery(parsed, p, pokemonSchema)));
      assert.doesNotThrow(() => CARD_FIXTURE.forEach((c) => matchesQuery(parsed, c, cardSchema)));
    });
  }

  for (const query of allExamples) {
    test(`"${query}" is classified as advanced syntax (uses field/operator/boolean syntax)`, () => {
      assert.equal(isAdvancedQuery(query), true);
    });
  }

  test('name:char* — starts with "char"', () => {
    assert.deepEqual(pokemonNames('name:char*'), ['charizard', 'charmander']);
  });

  test('!type:water — excludes the one water-type fixture entry (blastoise)', () => {
    assert.deepEqual(pokemonNames('!type:water'), pokemonNames('NOT type:water'));
    assert.ok(!pokemonNames('!type:water').includes('blastoise'));
    assert.ok(pokemonNames('!type:water').includes('charizard'));
  });

  test('NOT owned:true — cards not owned', () => {
    assert.deepEqual(cardIds('NOT owned:true'), ['base1-15', 'sv5-99']);
  });

  test('type:fire OR type:water — widens across two types', () => {
    assert.deepEqual(pokemonNames('type:fire OR type:water'), ['blastoise', 'charizard', 'charmander', 'typhlosion']);
  });

  test('(gen:1 AND type:fire) AND NOT name:charmander — the documented grouping example', () => {
    assert.deepEqual(pokemonNames('(gen:1 AND type:fire) AND NOT name:charmander'), ['charizard']);
  });

  test('(type:fire OR type:water) AND gen:1 — excludes the gen-2 fire mon', () => {
    assert.deepEqual(pokemonNames('(type:fire OR type:water) AND gen:1'), ['blastoise', 'charizard', 'charmander']);
  });

  test('NOT (type:fire OR type:water) — the remaining non-fire, non-water mons', () => {
    assert.deepEqual(pokemonNames('NOT (type:fire OR type:water)'), ['pikachu', 'venusaur']);
  });

  test('set:"Temporal Forces" rarity!=common — quoted set name plus a != comparison', () => {
    assert.deepEqual(cardIds('set:"Temporal Forces" rarity!=common'), ['sv5-99']);
  });

  test('owned:false rarity:common — the corrected "More examples" entry', () => {
    // The only Common-rarity card in this fixture (base1-58, Pikachu) is owned, so the
    // combined filter correctly returns nothing here — it's the AND-of-two-fields wiring
    // being exercised, not a specific non-empty result.
    assert.deepEqual(cardIds('owned:false rarity:common'), []);
  });

  test('collection:"Charizard Deck" — every card filed in one named collection', () => {
    assert.deepEqual(cardIds('collection:"Charizard Deck"'), ['base1-4', 'base1-58']);
  });

  test('pikachu NOT collection:* — pikachu cards filed nowhere (none in this fixture)', () => {
    // The one Pikachu card in the fixture IS filed in two collections, so this correctly
    // returns nothing — exercises the "collection:*" idiom end-to-end via a real query string.
    assert.deepEqual(cardIds('pikachu NOT collection:*'), []);
  });
});
