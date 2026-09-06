// Tests for the advanced-search autocomplete logic (extracted from AdvancedSearchInput.tsx
// into advancedSearchLogic.ts specifically so it's testable without a JSX-capable runtime).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applySuggestion, computeSuggestions, currentToken } from '../advancedSearchLogic.ts';
import { cardSchema, pokemonSchema } from './fixtures.ts';

describe('currentToken', () => {
  test('cursor at end of a single word returns the whole word', () => {
    assert.deepEqual(currentToken('charizard', 9), { start: 0, text: 'charizard' });
  });

  test('cursor in the middle of a word returns the prefix up to the cursor', () => {
    assert.deepEqual(currentToken('charizard', 4), { start: 0, text: 'char' });
  });

  test('cursor at position 0 returns an empty token', () => {
    assert.deepEqual(currentToken('charizard', 0), { start: 0, text: '' });
  });

  test('a space before the cursor bounds the token', () => {
    assert.deepEqual(currentToken('type:fire hp', 12), { start: 10, text: 'hp' });
  });

  test('a "(" before the cursor bounds the token', () => {
    assert.deepEqual(currentToken('(type:fire', 10), { start: 1, text: 'type:fire' });
  });

  test('a ")" before the cursor bounds the token', () => {
    assert.deepEqual(currentToken(')type', 5), { start: 1, text: 'type' });
  });

  test('empty string input', () => {
    assert.deepEqual(currentToken('', 0), { start: 0, text: '' });
  });

  test('cursor immediately after a space returns an empty token', () => {
    assert.deepEqual(currentToken('type:fire ', 10), { start: 10, text: '' });
  });

  test('multiple consecutive spaces do not break token boundary detection', () => {
    assert.deepEqual(currentToken('type:fire   hp', 14), { start: 12, text: 'hp' });
  });
});

describe('computeSuggestions — field names', () => {
  test('empty token suggests all field keys (and no keywords beyond the 12 cap)', () => {
    const sugs = computeSuggestions('', pokemonSchema);
    assert.ok(sugs.length > 0);
    assert.ok(sugs.length <= 12);
    assert.ok(sugs.every((s) => typeof s.insertText === 'string'));
  });

  test('a partial field prefix filters to matching keys', () => {
    const sugs = computeSuggestions('att', pokemonSchema);
    assert.ok(sugs.some((s) => s.insertText === 'attack:'));
    assert.ok(sugs.every((s) => s.insertText.startsWith('att') || ['AND', 'OR', 'NOT'].some((k) => s.insertText.startsWith(k))));
  });

  test('matches aliases too, not just primary keys (atk -> attack)', () => {
    const sugs = computeSuggestions('atk', pokemonSchema);
    assert.ok(sugs.some((s) => s.insertText === 'atk:' && s.hint === 'Attack'));
  });

  test('matches box/location aliases for the collection field', () => {
    const sugs = computeSuggestions('loc', cardSchema);
    assert.ok(sugs.some((s) => s.insertText === 'location:' && s.hint === 'Collection'));
  });

  test('a non-matching prefix returns no field or keyword suggestions', () => {
    const sugs = computeSuggestions('zzzzz', pokemonSchema);
    assert.deepEqual(sugs, []);
  });

  test('field suggestions are capped at 12 total (fields + keywords)', () => {
    const sugs = computeSuggestions('', cardSchema);
    assert.ok(sugs.length <= 12);
  });
});

describe('computeSuggestions — keywords', () => {
  test('"a" suggests the AND keyword alongside any matching field names', () => {
    const sugs = computeSuggestions('a', pokemonSchema);
    assert.ok(sugs.some((s) => s.label === 'AND' && s.hint === 'operator'));
  });

  test('"o" suggests the OR keyword', () => {
    const sugs = computeSuggestions('o', pokemonSchema);
    assert.ok(sugs.some((s) => s.label === 'OR'));
  });

  test('"n" suggests the NOT keyword', () => {
    const sugs = computeSuggestions('n', pokemonSchema);
    assert.ok(sugs.some((s) => s.label === 'NOT'));
  });

  test('keyword matching is case-insensitive against the typed prefix', () => {
    const lower = computeSuggestions('an', pokemonSchema);
    const upper = computeSuggestions('AN', pokemonSchema);
    assert.deepEqual(lower.map((s) => s.label).sort(), upper.map((s) => s.label).sort());
  });

  test('a "!" negation prefix suppresses keyword suggestions', () => {
    const sugs = computeSuggestions('!a', pokemonSchema);
    assert.ok(!sugs.some((s) => s.hint === 'operator'));
  });

  test('a "!" negation prefix still suggests matching fields, negated', () => {
    const sugs = computeSuggestions('!att', pokemonSchema);
    assert.ok(sugs.some((s) => s.insertText === '!attack:'));
  });

  test('bare "!" with no field prefix suggests all fields negated', () => {
    const sugs = computeSuggestions('!', pokemonSchema);
    assert.ok(sugs.length > 0);
    assert.ok(sugs.every((s) => s.insertText.startsWith('!')));
  });
});

describe('computeSuggestions — clause values', () => {
  test('a complete field:partial-value clause suggests matching known values', () => {
    const sugs = computeSuggestions('type:fi', pokemonSchema);
    assert.ok(sugs.some((s) => s.label === 'fire'));
    assert.ok(sugs.every((s) => s.insertText.startsWith('type:')));
  });

  test('value suggestions are deduplicated case-insensitively', () => {
    const sugs = computeSuggestions('rarity:common', cardSchema);
    const labels = sugs.map((s) => s.label.toLowerCase());
    assert.equal(labels.length, new Set(labels).size);
  });

  test('a value suggestion containing a space is quoted in the inserted text', () => {
    const sugs = computeSuggestions('set:', cardSchema);
    const sv = sugs.find((s) => s.label === 'Temporal Forces');
    assert.ok(sv);
    assert.equal(sv!.insertText, 'set:"Temporal Forces" ');
  });

  test('a value suggestion with no space is not quoted', () => {
    const sugs = computeSuggestions('set:', cardSchema);
    const base = sugs.find((s) => s.label === 'Base');
    assert.ok(base);
    assert.equal(base!.insertText, 'set:Base ');
  });

  test('a field with no suggestions list returns no clause-value suggestions', () => {
    const sugs = computeSuggestions('name:cha', pokemonSchema);
    assert.deepEqual(sugs, []);
  });

  test('an unknown field in clause position returns no suggestions', () => {
    const sugs = computeSuggestions('bogus:x', pokemonSchema);
    assert.deepEqual(sugs, []);
  });

  test('clause value suggestions are capped at 12', () => {
    const sugs = computeSuggestions('series:', cardSchema);
    assert.ok(sugs.length <= 12);
  });

  test('!= clause op also triggers value suggestions', () => {
    const sugs = computeSuggestions('type!=fi', pokemonSchema);
    assert.ok(sugs.some((s) => s.label === 'fire'));
  });

  test('>= clause op on a field with no suggestions list returns nothing (not a crash)', () => {
    assert.doesNotThrow(() => computeSuggestions('hp>=5', pokemonSchema));
  });
});

describe('applySuggestion', () => {
  test('splices the suggestion in at the token start, replacing through the cursor', () => {
    const result = applySuggestion('type:fi', 0, 7, { label: 'fire', insertText: 'type:fire ' });
    assert.deepEqual(result, { text: 'type:fire ', cursor: 10 });
  });

  test('preserves text after the cursor', () => {
    const result = applySuggestion('type:fi hp>50', 0, 7, { label: 'fire', insertText: 'type:fire ' });
    assert.deepEqual(result, { text: 'type:fire  hp>50', cursor: 10 });
  });

  test('preserves text before the token start', () => {
    const result = applySuggestion('gen:1 att', 6, 9, { label: 'attack', insertText: 'attack:' });
    assert.deepEqual(result, { text: 'gen:1 attack:', cursor: 13 });
  });

  test('token start equal to cursor (empty token) inserts without removing anything', () => {
    const result = applySuggestion('gen:1 ', 6, 6, { label: 'AND', insertText: 'AND ' });
    assert.deepEqual(result, { text: 'gen:1 AND ', cursor: 10 });
  });
});
