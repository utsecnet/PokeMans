// Performance suite for the advanced search feature. Runs the same parseQuery/matchesQuery
// path the browser uses for the client-side "bulk fetch + filter" mode (client/src/lib/
// queryLanguage.ts), against synthetic datasets shaped like the real card list
// (client/src/lib/__tests__/fixtures.ts's generateCardDataset), at sizes spanning the app's
// real range: the server pageSize cap is 200, the advanced-search bulk fetch caps at 25,000,
// and a full card sync is currently ~17,000+ rows.
//
// Thresholds here are intentionally generous (an order of magnitude above what this runs in
// on a typical dev machine) — the goal is to catch a real algorithmic regression (e.g. an
// accidental O(n^2) or a reintroduced ReDoS), not to enforce a tight budget that would make
// this suite flaky on a slower CI box.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchesQuery, parseQuery } from '../queryLanguage.ts';
import { cardSchema, generateCardDataset } from '../__tests__/fixtures.ts';
import { computeSuggestions } from '../advancedSearchLogic.ts';

const SIZES = [100, 1000, 5000, 17000, 25000];

function timeFilter(dataset: ReturnType<typeof generateCardDataset>, query: string): number {
  const parsed = parseQuery(query);
  const start = performance.now();
  dataset.filter((c) => matchesQuery(parsed, c, cardSchema));
  return performance.now() - start;
}

// One dataset per size, built once and reused across every query-shape test below (building
// a fresh 25,000-item dataset per test would dominate the suite's own runtime).
const DATASETS = new Map(SIZES.map((n) => [n, generateCardDataset(n)] as const));

describe('filter throughput across dataset sizes', () => {
  const QUERIES: Array<{ label: string; query: string; budgetMsPer25k: number }> = [
    { label: 'plain text (no field)', query: 'Charizard', budgetMsPer25k: 200 },
    { label: 'single text field', query: 'name:Pikachu', budgetMsPer25k: 200 },
    { label: 'single list field', query: 'type:fire', budgetMsPer25k: 200 },
    { label: 'boolean field', query: 'owned:true', budgetMsPer25k: 200 },
    { label: 'date comparison', query: 'release>=2010/01/01', budgetMsPer25k: 200 },
    { label: 'AND of three clauses', query: 'type:fire owned:true rarity:Common', budgetMsPer25k: 250 },
    { label: 'OR of three clauses', query: 'type:fire OR type:water OR type:grass', budgetMsPer25k: 250 },
    {
      label: 'grouped + negated (help-page shape)',
      query: '(type:fire OR type:water) AND NOT owned:true',
      budgetMsPer25k: 300,
    },
    { label: 'single wildcard', query: 'name:Char*', budgetMsPer25k: 250 },
    { label: 'two wildcards', query: 'name:*har* set:*et*', budgetMsPer25k: 300 },
    { label: 'collection:* idiom', query: 'NOT collection:*', budgetMsPer25k: 250 },
  ];

  for (const { label, query, budgetMsPer25k } of QUERIES) {
    test(`${label} — "${query}" stays within budget at every dataset size`, () => {
      for (const size of SIZES) {
        const dataset = DATASETS.get(size)!;
        const elapsed = timeFilter(dataset, query);
        const budget = (budgetMsPer25k * size) / 25000 + 20; // scale down, plus a fixed floor
        assert.ok(
          elapsed < budget,
          `size=${size} query=${JSON.stringify(query)} took ${elapsed.toFixed(2)}ms, budget ${budget.toFixed(2)}ms`,
        );
      }
    });
  }
});

describe('scaling is roughly linear, not quadratic', () => {
  // A real O(n^2) regression (e.g. re-scanning the full field list per item per term, or a
  // reintroduced backtracking-regex wildcard) would blow this ratio up far past 5-10x; a
  // healthy linear-ish implementation stays close to the 5x growth in dataset size.
  const query = '(type:fire OR type:water) AND NOT owned:true';

  test('25,000 items takes well under 25x the time of 5,000 items', () => {
    const small = DATASETS.get(5000)!;
    const large = DATASETS.get(25000)!;
    // Warm up (JIT) before measuring either.
    timeFilter(small, query);
    timeFilter(large, query);
    const tSmall = Math.max(timeFilter(small, query), 0.01);
    const tLarge = timeFilter(large, query);
    const ratio = tLarge / tSmall;
    assert.ok(ratio < 25, `5000->25000 (5x data) took ${ratio.toFixed(2)}x longer, expected well under 25x`);
  });
});

describe('wildcard matching stays fast at scale (ReDoS regression guard)', () => {
  test('a many-segment wildcard pattern against 25,000 items completes quickly', () => {
    const dataset = DATASETS.get(25000)!;
    const query = 'name:C*h*a*r*i*z*a*r*d*';
    const start = performance.now();
    const parsed = parseQuery(query);
    dataset.forEach((c) => matchesQuery(parsed, c, cardSchema));
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 500, `wildcard-heavy filter over 25,000 items took ${elapsed.toFixed(2)}ms`);
  });

  test('a pathological wildcard pattern against a long non-matching value never hangs', () => {
    const item = { ...DATASETS.get(100)![0], name: 'a'.repeat(500) };
    const query = 'name:' + 'a*'.repeat(20) + 'b';
    const parsed = parseQuery(query);
    const start = performance.now();
    matchesQuery(parsed, item, cardSchema);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 100, `pathological wildcard took ${elapsed.toFixed(2)}ms, expected near-instant`);
  });
});

describe('parse cost for long/complex queries', () => {
  test('a long chain of ANDed clauses parses quickly', () => {
    const query = Array.from({ length: 500 }, () => 'type:fire').join(' AND ');
    const start = performance.now();
    assert.doesNotThrow(() => parseQuery(query));
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 100, `parsing 500 ANDed clauses took ${elapsed.toFixed(2)}ms`);
  });

  test('a deeply nested grouped query parses quickly', () => {
    const query = '('.repeat(200) + 'type:fire' + ')'.repeat(200);
    const start = performance.now();
    assert.doesNotThrow(() => parseQuery(query));
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 100, `parsing 200 nested groups took ${elapsed.toFixed(2)}ms`);
  });
});

describe('autocomplete (computeSuggestions) cost', () => {
  test('1000 successive suggestion computations against the card schema stay fast', () => {
    const tokens = ['', 'na', 'set:', 'rarity:com', 'type:f', '!col', 'owned:t', 'a', 'o', 'n'];
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      computeSuggestions(tokens[i % tokens.length], cardSchema);
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 200, `1000 computeSuggestions calls took ${elapsed.toFixed(2)}ms`);
  });
});
