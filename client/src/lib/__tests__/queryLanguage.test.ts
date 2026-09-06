// Regression suite for the advanced search query language (client/src/lib/queryLanguage.ts).
// Deliberately black-box: tests go through the same public API the app uses
// (parseQuery / matchesQuery / isAdvancedQuery), not internal helpers — so a refactor of
// the parser's internals doesn't require rewriting the tests, only a real behavior change
// should ever break one of these.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isAdvancedQuery, matchesQuery, parseQuery } from '../queryLanguage.ts';
import { CARD_FIXTURE, POKEMON_FIXTURE, TRAINER_CARD, cardSchema, pokemonSchema } from './fixtures.ts';

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

describe('free text (no field prefix)', () => {
  test('matches the default text field(s), case-insensitively', () => {
    assert.deepEqual(pokemonNames('CHAR'), ['charizard', 'charmander']);
  });

  test('matches a substring anywhere in the name', () => {
    assert.deepEqual(pokemonNames('char'), ['charizard', 'charmander']);
  });

  test('cards search both name and pokemon (two default text fields)', () => {
    // "charizard" matches card name AND pokemonName for the same card, should not duplicate
    assert.deepEqual(cardIds('charizard'), ['base1-4']);
    assert.deepEqual(cardIds('boulder'), ['sv5-99']); // matches card name only
  });

  test('no match returns empty, not an error', () => {
    assert.deepEqual(pokemonNames('zzzznonexistent'), []);
  });

  test('empty query matches everything', () => {
    assert.equal(pokemonNames('').length, POKEMON_FIXTURE.length);
    assert.equal(pokemonNames('   ').length, POKEMON_FIXTURE.length);
  });
});

describe('field clauses — text type', () => {
  test('name:value is a substring match', () => {
    assert.deepEqual(pokemonNames('name:char'), ['charizard', 'charmander']);
  });

  test('quoted value with a space', () => {
    assert.deepEqual(cardIds('set:"Temporal Forces"'), ['sv5-99']);
  });

  test('field name is case-insensitive', () => {
    assert.deepEqual(pokemonNames('NAME:char'), pokemonNames('name:char'));
    assert.deepEqual(pokemonNames('Name:char'), pokemonNames('name:char'));
  });

  test('= behaves the same as : for text fields', () => {
    assert.deepEqual(pokemonNames('name=char'), pokemonNames('name:char'));
  });

  test('!= inverts a text match', () => {
    const all = pokemonNames('');
    const notChar = pokemonNames('name!=char');
    assert.deepEqual(notChar, all.filter((n) => !n.includes('char')));
  });
});

describe('field clauses — list type', () => {
  test('exact match against any element', () => {
    assert.deepEqual(pokemonNames('type:fire'), ['charizard', 'charmander', 'typhlosion']);
  });

  test('is case-insensitive', () => {
    assert.deepEqual(pokemonNames('type:Fire'), pokemonNames('type:fire'));
    assert.deepEqual(pokemonNames('type:FIRE'), pokemonNames('type:fire'));
  });

  test('does not substring-match (list fields require an exact element match)', () => {
    // "fir" should not match "fire" for a plain (non-wildcard) list clause
    assert.deepEqual(pokemonNames('type:fir'), []);
  });

  test('!= excludes matching items', () => {
    assert.deepEqual(pokemonNames('type!=fire'), ['blastoise', 'pikachu', 'venusaur']);
  });

  test('alias resolves to the same field', () => {
    assert.deepEqual(pokemonNames('types:fire'), pokemonNames('type:fire'));
  });
});

describe('field clauses — number type', () => {
  test(': and = mean equals', () => {
    assert.deepEqual(pokemonNames('hp:78'), ['charizard', 'typhlosion']);
    assert.deepEqual(pokemonNames('hp=78'), pokemonNames('hp:78'));
  });

  test('!= excludes an exact value', () => {
    assert.ok(!pokemonNames('hp!=78').includes('charizard'));
    assert.ok(pokemonNames('hp!=78').includes('pikachu'));
  });

  test('> >= < <= comparisons', () => {
    // hp: charizard 78, charmander 39, blastoise 79, venusaur 80, pikachu 35, typhlosion 78
    assert.deepEqual(pokemonNames('hp>79'), ['venusaur']);
    assert.deepEqual(pokemonNames('hp>=79'), ['blastoise', 'venusaur']);
    assert.deepEqual(pokemonNames('hp<39'), ['pikachu']);
    assert.deepEqual(pokemonNames('hp<=39'), ['charmander', 'pikachu']);
  });

  test('a..b range is inclusive on both ends', () => {
    assert.deepEqual(pokemonNames('hp:78..80'), ['blastoise', 'charizard', 'typhlosion', 'venusaur']);
  });

  test('alias resolves to the same field (atk -> attack)', () => {
    assert.deepEqual(pokemonNames('atk>80'), pokemonNames('attack>80'));
  });

  test('a non-numeric value never matches rather than throwing', () => {
    assert.doesNotThrow(() => pokemonNames('hp>banana'));
    assert.deepEqual(pokemonNames('hp>banana'), []);
  });

  test('toRaw converts a display-unit value for comparison (height in meters -> stored decimeters)', () => {
    // charizard height=17 (1.7m), typhlosion height=17 too
    assert.deepEqual(pokemonNames('height>=1.7'), ['charizard', 'typhlosion', 'venusaur']);
    assert.deepEqual(pokemonNames('height:1.5..1.8'), ['blastoise', 'charizard', 'typhlosion']);
  });
});

describe('field clauses — boolean type', () => {
  test('owned:true / owned:false', () => {
    assert.deepEqual(cardIds('owned:true'), ['base1-2', 'base1-4', 'base1-58']);
    assert.deepEqual(cardIds('owned:false'), ['base1-15', 'sv5-99']);
  });

  test('accepts yes/1 as truthy spellings', () => {
    assert.deepEqual(cardIds('owned:yes'), cardIds('owned:true'));
    assert.deepEqual(cardIds('owned:1'), cardIds('owned:true'));
  });

  test('!= inverts', () => {
    assert.deepEqual(cardIds('owned!=true'), cardIds('owned:false'));
  });
});

describe('field clauses — date type', () => {
  test('bare value matches an exact date or substring', () => {
    assert.deepEqual(cardIds('release:2024/03/22'), ['sv5-99']);
  });

  test('> >= < <= compare lexicographically (works for YYYY/MM/DD)', () => {
    assert.deepEqual(cardIds('release>2000/01/01'), ['sv5-99']);
    assert.deepEqual(cardIds('release<2000/01/01').sort(), ['base1-15', 'base1-2', 'base1-4', 'base1-58'].sort());
  });

  test('alias resolves (releasedate, released)', () => {
    assert.deepEqual(cardIds('releasedate>2000/01/01'), cardIds('release>2000/01/01'));
    assert.deepEqual(cardIds('released>2000/01/01'), cardIds('release>2000/01/01'));
  });
});

describe('collection field (the "where is my card" use case)', () => {
  test('matches by exact collection name', () => {
    assert.deepEqual(cardIds('collection:"Charizard Deck"'), ['base1-4', 'base1-58']);
  });

  test('box/location aliases resolve to the same field', () => {
    assert.deepEqual(cardIds('box:"Bulk Box"'), cardIds('collection:"Bulk Box"'));
    assert.deepEqual(cardIds('location:"Bulk Box"'), cardIds('collection:"Bulk Box"'));
  });

  test('collection:* matches anything filed anywhere', () => {
    assert.deepEqual(cardIds('collection:*'), ['base1-2', 'base1-4', 'base1-58']);
  });

  test('NOT collection:* finds unfiled cards', () => {
    assert.deepEqual(cardIds('NOT collection:*'), ['base1-15', 'sv5-99']);
  });
});

describe('printed card types (TCG energy vocabulary)', () => {
  test('matches a TCG-only type that has no Pokémon equivalent', () => {
    assert.deepEqual(cardIds('type:Lightning'), ['base1-58']);
    assert.deepEqual(cardIds('type:Fighting'), ['sv5-99']);
  });

  test('is case-insensitive, so the stored casing does not have to be typed', () => {
    assert.deepEqual(cardIds('type:lightning'), cardIds('type:Lightning'));
    assert.deepEqual(cardIds('type:FIRE'), cardIds('type:Fire'));
  });

  test('a card prints one energy even when the Pokémon is dual-type', () => {
    // The Pokémon Charizard is Fire/Flying; the card is Fire.
    assert.deepEqual(cardIds('type:Fire'), ['base1-4']);
    assert.deepEqual(cardIds('type:Flying'), []);
  });

  test('the Pokémon-type name does not match a card printing the TCG name', () => {
    // "electric" is the Pokémon vocabulary; the Pikachu card prints "Lightning".
    assert.deepEqual(cardIds('type:electric'), []);
  });
});

describe('print variants', () => {
  test('finds cards by finish', () => {
    assert.deepEqual(cardIds('variant:holo'), ['base1-4']);
    assert.deepEqual(cardIds('variant:reverse'), ['base1-58']);
  });

  test('finds cards by the subtype that separates printings sharing a finish', () => {
    // Base Set Charizard has two holo printings; only one is Shadowless.
    assert.deepEqual(cardIds('variant:shadowless'), ['base1-4']);
    assert.deepEqual(cardIds('variant:unlimited'), ['base1-4']);
  });

  test('finds cards by stamp — the thing that marks a 1st Edition print', () => {
    assert.deepEqual(cardIds('variant:1st-edition'), ['base1-4']);
  });

  test('is case-insensitive, so the stored casing need not be typed exactly', () => {
    assert.deepEqual(cardIds('variant:SHADOWLESS'), cardIds('variant:shadowless'));
  });

  test('the "variants" and "printing" aliases resolve to the same field', () => {
    assert.deepEqual(cardIds('variants:holo'), cardIds('variant:holo'));
    assert.deepEqual(cardIds('printing:holo'), cardIds('variant:holo'));
  });

  test('negation finds cards without a printing', () => {
    assert.ok(!cardIds('NOT variant:holo').includes('base1-4'));
  });

  test('combines with other clauses', () => {
    assert.deepEqual(cardIds('variant:1st-edition type:Fire'), ['base1-4']);
  });
});

describe('Trainer/Energy cards (no linked Pokémon)', () => {
  // These carry pokemonId/pokemonName === null. The card schema searches `pokemon` as one
  // of its default text fields, so a null there must simply not match rather than throw.
  const withTrainer = [...CARD_FIXTURE, TRAINER_CARD];
  const ids = (query: string) => {
    const parsed = parseQuery(query);
    return withTrainer
      .filter((c) => matchesQuery(parsed, c, cardSchema))
      .map((c) => c.id)
      .sort();
  };

  test('a bare word still matches the card name when pokemonName is null', () => {
    assert.deepEqual(ids('oak'), ['base1-102']);
  });

  test('a null pokemon field never matches, and never throws', () => {
    assert.doesNotThrow(() => ids('pokemon:oak'));
    assert.deepEqual(ids('pokemon:oak'), []);
  });

  test('a wildcard against the null pokemon field does not match', () => {
    assert.deepEqual(ids('pokemon:*'), CARD_FIXTURE.map((c) => c.id).sort());
  });

  test('NOT pokemon:* is how you find the cards with no Pokémon', () => {
    assert.deepEqual(ids('NOT pokemon:*'), ['base1-102']);
  });

  test('!= still matches a null field — a Trainer genuinely is not Charizard', () => {
    assert.ok(ids('pokemon!=charizard').includes('base1-102'));
  });

  test('a null date does not satisfy a comparison (absent is unknown, not earliest)', () => {
    const undated = { ...TRAINER_CARD, id: 'undated-1', releaseDate: null };
    const parsed = parseQuery('release<2000/01/01');
    assert.equal(matchesQuery(parsed, undated, cardSchema), false);
  });

  test('supertype filters Trainer cards in', () => {
    assert.deepEqual(ids('supertype:Trainer'), ['base1-102']);
  });

  test('supertype excludes them again with !=', () => {
    assert.deepEqual(ids('supertype!=Trainer'), CARD_FIXTURE.map((c) => c.id).sort());
  });

  test('the "kind" alias resolves to supertype', () => {
    assert.deepEqual(ids('kind:Trainer'), ids('supertype:Trainer'));
  });

  test('Trainer cards still participate in collection queries', () => {
    assert.deepEqual(ids('collection:"Bulk Box" supertype:Trainer'), ['base1-102']);
  });

  test('a type clause never matches a Trainer card (it has no types)', () => {
    assert.ok(!ids('type:fire').includes('base1-102'));
  });
});

describe('negation', () => {
  test('leading ! and NOT keyword are equivalent', () => {
    assert.deepEqual(pokemonNames('!type:fire'), pokemonNames('NOT type:fire'));
  });

  test('negation is case-insensitive for the keyword', () => {
    assert.deepEqual(pokemonNames('not type:fire'), pokemonNames('NOT type:fire'));
    assert.deepEqual(pokemonNames('Not type:fire'), pokemonNames('NOT type:fire'));
  });

  test('! also negates a bare free-text word', () => {
    assert.deepEqual(pokemonNames('!char'), POKEMON_FIXTURE.map((p) => p.name).sort().filter((n) => !n.includes('char')));
  });

  test('double negation cancels out', () => {
    assert.deepEqual(pokemonNames('NOT NOT type:fire'), pokemonNames('type:fire'));
  });

  test('glued double "!!" (no space) also cancels out, same as a bare field clause', () => {
    // Regression: the tokenizer glues consecutive "!" into one word (e.g. "!!type:fire"),
    // and the parser must strip every leading "!" from that word, not just the first —
    // otherwise the stray "!" left on the value breaks field-clause parsing entirely.
    assert.deepEqual(pokemonNames('!!type:fire'), pokemonNames('type:fire'));
  });

  test('glued triple "!!!" (no space) is equivalent to a single negation', () => {
    assert.deepEqual(pokemonNames('!!!name:charizard'), pokemonNames('!name:charizard'));
  });

  test('glued "!!" on a bare word also cancels out', () => {
    assert.deepEqual(pokemonNames('!!char'), pokemonNames('char'));
  });
});

describe('AND / OR / precedence', () => {
  test('space between clauses is implicit AND', () => {
    assert.deepEqual(pokemonNames('type:fire hp>70'), ['charizard', 'typhlosion']);
  });

  test('explicit AND is the same as implicit', () => {
    assert.deepEqual(pokemonNames('type:fire AND hp>70'), pokemonNames('type:fire hp>70'));
  });

  test('AND keyword is case-insensitive', () => {
    assert.deepEqual(pokemonNames('type:fire and hp>70'), pokemonNames('type:fire AND hp>70'));
  });

  test('OR widens the match', () => {
    assert.deepEqual(pokemonNames('type:water OR type:grass'), ['blastoise', 'venusaur']);
  });

  test('AND binds tighter than OR: "a OR b AND c" = "a OR (b AND c)"', () => {
    // generation:1 alone already covers everyone except typhlosion (the only gen-2 mon);
    // "OR generation:2 type:fire" is (generation:2 AND type:fire), which is exactly
    // typhlosion — so the full query should match all six fixture Pokémon.
    assert.deepEqual(
      pokemonNames('generation:1 OR generation:2 type:fire'),
      POKEMON_FIXTURE.map((p) => p.name).sort(),
    );
  });
});

describe('grouping with parentheses', () => {
  test('overrides default precedence', () => {
    assert.deepEqual(pokemonNames('(type:water OR type:grass) AND hp>75'), ['blastoise', 'venusaur']);
  });

  test('NOT applied to a group', () => {
    const all = pokemonNames('');
    const fireOrWater = pokemonNames('type:fire OR type:water');
    assert.deepEqual(pokemonNames('NOT (type:fire OR type:water)'), all.filter((n) => !fireOrWater.includes(n)));
  });

  test('nested groups', () => {
    assert.deepEqual(pokemonNames('((type:fire))'), pokemonNames('type:fire'));
  });

  test('an unclosed paren is tolerated, not an error', () => {
    assert.doesNotThrow(() => pokemonNames('(type:fire'));
    assert.deepEqual(pokemonNames('(type:fire'), pokemonNames('type:fire'));
  });

  test('the exact worked example from the help page', () => {
    assert.deepEqual(pokemonNames('(generation:1 AND type:fire) AND NOT name:charmander'), ['charizard']);
  });

  test('mixed case matches the same worked example', () => {
    assert.deepEqual(
      pokemonNames('(Generation:1 AND type:fire) And not Name:charmander'),
      ['charizard'],
    );
  });
});

describe('wildcards', () => {
  test('* matches any run of characters, anchored to the whole value', () => {
    assert.deepEqual(pokemonNames('name:char*'), ['charizard', 'charmander']);
  });

  test('* at the start matches a suffix', () => {
    assert.deepEqual(pokemonNames('name:*zard'), ['charizard']);
  });

  test('* on both sides matches "contains"', () => {
    assert.deepEqual(pokemonNames('name:*char*'), ['charizard', 'charmander']);
  });

  test('without a wildcard, the match is "contains" (substring), not anchored', () => {
    assert.deepEqual(pokemonNames('name:zard'), ['charizard']); // "zard" mid-word, no wildcard needed
  });

  test('? matches exactly one character', () => {
    assert.deepEqual(pokemonNames('name:pika?hu'), ['pikachu']);
    assert.deepEqual(pokemonNames('name:pika??hu'), []); // wrong length
  });

  test('wildcards work on list fields too', () => {
    assert.deepEqual(pokemonNames('type:fir*'), pokemonNames('type:fire'));
  });

  test('wildcards are case-insensitive', () => {
    assert.deepEqual(pokemonNames('name:CHAR*'), pokemonNames('name:char*'));
  });

  test('regex special characters in the pattern are escaped, not interpreted', () => {
    // "char(" contains a literal paren-looking character that must not be treated as regex syntax
    assert.doesNotThrow(() => pokemonNames('name:char[*'));
  });

  test('a bare wildcarded word (no field) still searches the default text field', () => {
    assert.deepEqual(pokemonNames('char*'), ['charizard', 'charmander']);
  });
});

describe('unknown fields and malformed clauses', () => {
  test('an unrecognized field name never matches, does not throw', () => {
    assert.doesNotThrow(() => pokemonNames('nosuchfield:whatever'));
    assert.deepEqual(pokemonNames('nosuchfield:whatever'), []);
  });

  test('a field-shaped token that is actually just punctuation falls back to free text', () => {
    // no letters before ":" -> not a valid field name per the parser's own rules
    assert.doesNotThrow(() => pokemonNames(':::'));
  });
});

describe('isAdvancedQuery classification', () => {
  const advanced = [
    'type:fire',
    'hp>50',
    'a AND b',
    'a OR b',
    'NOT a',
    '!a',
    'a !b',
    '(a)',
    'a*',
    'a?b',
    'name!=x',
  ];
  const plain = ['pikachu', 'iron boulder', 'char', '  charizard  ', 'multi word search'];

  for (const q of advanced) {
    test(`"${q}" is classified as advanced`, () => assert.equal(isAdvancedQuery(q), true));
  }
  for (const q of plain) {
    test(`"${q}" is classified as plain (fast path)`, () => assert.equal(isAdvancedQuery(q), false));
  }

  test('empty/whitespace-only is not advanced', () => {
    assert.equal(isAdvancedQuery(''), false);
    assert.equal(isAdvancedQuery('   '), false);
  });
});
