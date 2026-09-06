// Schema-correctness suite: structural invariants the query schemas must hold for
// resolveField()/autocomplete to work correctly. These aren't behavior tests against
// fixture data — they're sanity checks on the schema shape itself, run against the real
// buildPokemonQuerySchema/buildCardQuerySchema output (via fixtures.ts).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldDef, FieldType, QuerySchema } from '../queryLanguage.ts';
import { cardSchema, pokemonSchema } from './fixtures.ts';

const VALID_TYPES: FieldType[] = ['text', 'list', 'number', 'boolean', 'date'];

function checkSchema<T>(name: string, schema: QuerySchema<T>) {
  describe(name, () => {
    test('every field has a non-empty key and label', () => {
      for (const f of schema.fields) {
        assert.ok(f.key.length > 0, `field with empty key`);
        assert.ok(f.label.length > 0, `field "${f.key}" has an empty label`);
      }
    });

    test('field keys are lowercase (resolveField lowercases lookups, so a mixed-case key could never match)', () => {
      for (const f of schema.fields) {
        assert.equal(f.key, f.key.toLowerCase(), `field key "${f.key}" is not lowercase`);
      }
    });

    test('field keys are unique', () => {
      const keys = schema.fields.map((f) => f.key);
      const seen = new Set<string>();
      for (const k of keys) {
        assert.ok(!seen.has(k), `duplicate field key "${k}"`);
        seen.add(k);
      }
    });

    test('every FieldType is one of the valid enum values', () => {
      for (const f of schema.fields) {
        assert.ok(VALID_TYPES.includes(f.type), `field "${f.key}" has invalid type "${f.type}"`);
      }
    });

    test('aliases are lowercase', () => {
      for (const f of schema.fields) {
        for (const a of f.aliases ?? []) {
          assert.equal(a, a.toLowerCase(), `alias "${a}" on field "${f.key}" is not lowercase`);
        }
      }
    });

    test('no alias collides with another field\'s key', () => {
      const keys = new Set(schema.fields.map((f) => f.key));
      for (const f of schema.fields) {
        for (const a of f.aliases ?? []) {
          assert.ok(!keys.has(a), `alias "${a}" on field "${f.key}" collides with another field's key`);
        }
      }
    });

    test('no alias is duplicated within its own field\'s alias list', () => {
      for (const f of schema.fields) {
        const aliases = f.aliases ?? [];
        assert.equal(aliases.length, new Set(aliases).size, `field "${f.key}" has duplicate aliases`);
      }
    });

    test('no alias is shared across two different fields', () => {
      const owner = new Map<string, string>();
      for (const f of schema.fields) {
        for (const a of f.aliases ?? []) {
          const existing = owner.get(a);
          assert.ok(!existing, `alias "${a}" is claimed by both "${existing}" and "${f.key}"`);
          owner.set(a, f.key);
        }
      }
    });

    test('a field never lists itself as its own alias', () => {
      for (const f of schema.fields) {
        assert.ok(!(f.aliases ?? []).includes(f.key), `field "${f.key}" aliases itself`);
      }
    });

    test('defaultTextFields entries reference real field keys', () => {
      const keys = new Set(schema.fields.map((f) => f.key));
      for (const key of schema.defaultTextFields) {
        assert.ok(keys.has(key), `defaultTextFields references unknown key "${key}"`);
      }
    });

    test('defaultTextFields fields are of type "text" (matching bare words against a list/number field would be surprising)', () => {
      const byKey = new Map(schema.fields.map((f) => [f.key, f] as const));
      for (const key of schema.defaultTextFields) {
        const f = byKey.get(key);
        assert.ok(f, `defaultTextFields references unknown key "${key}"`);
        assert.equal(f!.type, 'text', `defaultTextFields field "${key}" is type "${f!.type}", not "text"`);
      }
    });

    test('every field has a get() function', () => {
      for (const f of schema.fields) {
        assert.equal(typeof f.get, 'function', `field "${f.key}" is missing get()`);
      }
    });

    test('toRaw, when present, is only on number fields and round-trips finite numbers to finite numbers', () => {
      for (const f of schema.fields as FieldDef<unknown>[]) {
        if (!f.toRaw) continue;
        assert.equal(f.type, 'number', `toRaw present on non-number field "${f.key}"`);
        for (const n of [0, 1, -1, 3.5, 1000]) {
          const out = f.toRaw(n);
          assert.ok(Number.isFinite(out), `toRaw(${n}) on field "${f.key}" produced non-finite ${out}`);
        }
      }
    });

    test('suggestions, when present, contain only strings', () => {
      for (const f of schema.fields) {
        if (!f.suggestions) continue;
        for (const s of f.suggestions) {
          assert.equal(typeof s, 'string', `field "${f.key}" has a non-string suggestion`);
        }
      }
    });
  });
}

checkSchema('pokemonSchema', pokemonSchema);
checkSchema('cardSchema', cardSchema);
