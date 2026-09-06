// A small query language for the advanced search bar. Grammar (AND binds tighter than
// OR; parentheses override precedence as usual):
//
//   orExpr  := andExpr (OR andExpr)*
//   andExpr := notExpr (AND? notExpr)*        -- AND is optional/implicit between terms
//   notExpr := (NOT | "!") notExpr | primary
//   primary := "(" orExpr ")" | clause | word
//   clause  := FIELD (":" | "=" | "!=" | ">" | ">=" | "<" | "<=") VALUE
//   VALUE   := WORD | "quoted phrase" | NUMBER".."NUMBER
//
// See client/src/pages/SearchHelp.tsx for the user-facing documentation.

export type ClauseOp = ':' | '=' | '!=' | '>' | '>=' | '<' | '<=';

export type Node =
  | { kind: 'and'; children: Node[] }
  | { kind: 'or'; children: Node[] }
  | { kind: 'not'; child: Node }
  | { kind: 'clause'; field: string; op: ClauseOp; value: string }
  | { kind: 'text'; value: string };

const OPERATORS: ClauseOp[] = ['!=', '>=', '<=', '>', '<', ':', '='];

function splitClause(word: string): { field: string; op: ClauseOp; value: string } | null {
  // Field names are a run of letters/digits/underscore right at the start of the token —
  // find the earliest operator that appears after at least one such character.
  const fieldMatch = word.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
  if (!fieldMatch) return null;
  const field = fieldMatch[0];
  const rest = word.slice(field.length);
  for (const op of OPERATORS) {
    if (rest.startsWith(op)) {
      return { field: field.toLowerCase(), op, value: rest.slice(op.length) };
    }
  }
  return null;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function leafFromWord(word: string): Node {
  const clause = splitClause(word);
  if (clause) return { kind: 'clause', field: clause.field, op: clause.op, value: unquote(clause.value) };
  return { kind: 'text', value: unquote(word) };
}

// Splits into tokens: "(" and ")" are always their own token (even glued to neighboring
// text, e.g. "(gen:1)"), a quoted "phrase with spaces" stays intact as one token, and
// everything else is whitespace-separated.
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    while (i < n && /\s/.test(input[i])) i++;
    if (i >= n) break;
    const ch = input[i];
    if (ch === '(' || ch === ')') {
      tokens.push(ch);
      i++;
      continue;
    }
    const start = i;
    while (i < n && !/\s/.test(input[i]) && input[i] !== '(' && input[i] !== ')') {
      if (input[i] === '"') {
        i++;
        while (i < n && input[i] !== '"') i++;
        if (i < n) i++; // consume closing quote
      } else {
        i++;
      }
    }
    tokens.push(input.slice(start, i));
  }
  return tokens;
}

class Parser {
  private tokens: string[];
  private pos: number;

  constructor(tokens: string[], pos = 0) {
    this.tokens = tokens;
    this.pos = pos;
  }

  private peek(): string | undefined {
    return this.tokens[this.pos];
  }

  private next(): string | undefined {
    return this.tokens[this.pos++];
  }

  parseOr(): Node {
    const children = [this.parseAnd()];
    while (this.peek()?.toUpperCase() === 'OR') {
      this.next();
      children.push(this.parseAnd());
    }
    return children.length === 1 ? children[0] : { kind: 'or', children };
  }

  private parseAnd(): Node {
    const children = [this.parseNot()];
    for (;;) {
      const t = this.peek();
      if (t === undefined || t === ')' || t.toUpperCase() === 'OR') break;
      if (t.toUpperCase() === 'AND') this.next(); // explicit AND is a no-op, just consume it
      children.push(this.parseNot());
    }
    return children.length === 1 ? children[0] : { kind: 'and', children };
  }

  private parseNot(): Node {
    const t = this.peek();
    if (t?.toUpperCase() === 'NOT') {
      this.next();
      return { kind: 'not', child: this.parseNot() };
    }
    if (t === '!') {
      this.next();
      return { kind: 'not', child: this.parseNot() };
    }
    if (t !== undefined && t.startsWith('!') && t.length > 1) {
      // The tokenizer glues consecutive "!" onto one word (no whitespace between them),
      // so a run like "!!!name:charizard" arrives as a single token — strip every leading
      // "!" here (not just one) so it recurses per the grammar rather than leaving stray
      // "!" characters stuck to the front of what becomes a free-text leaf.
      this.next();
      const bare = t.replace(/^!+/, '');
      const bangCount = t.length - bare.length;
      let node = leafFromWord(bare);
      for (let i = 0; i < bangCount; i++) node = { kind: 'not', child: node };
      return node;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const t = this.peek();
    if (t === '(') {
      this.next();
      const node = this.parseOr();
      if (this.peek() === ')') this.next(); // tolerate an unclosed paren rather than erroring
      return node;
    }
    if (t === undefined) return { kind: 'and', children: [] }; // vacuous — matches everything
    this.next();
    return leafFromWord(t);
  }
}

export function parseQuery(input: string): Node {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) return { kind: 'and', children: [] };
  return new Parser(tokens).parseOr();
}

export type FieldType = 'text' | 'list' | 'number' | 'boolean' | 'date';

export interface FieldDef<T> {
  key: string;
  label: string;
  aliases?: string[];
  type: FieldType;
  /** Raw value(s) for this field on one item. */
  get: (item: T) => string | number | boolean | string[] | null;
  /** Converts a typed display value (e.g. "1.2" meters) to the raw comparable number. */
  toRaw?: (n: number) => number;
  /** Known/suggested values for autocomplete, if enumerable. */
  suggestions?: string[];
}

export interface QuerySchema<T> {
  fields: FieldDef<T>[];
  defaultTextFields: string[]; // field keys searched for bare (non-field) words
}

// Field lookups are O(schema.fields.length) via a linear scan of the array; a filter pass
// reuses the same `schema` object (and often the same parsed query) across every item in
// the dataset (see CardBrowser.tsx/PokemonBrowser.tsx — both parse once via useMemo and
// filter the whole bulk-fetched array with it), so re-scanning every field for the same
// clause on every single item is pure waste. A WeakMap-cached index — built lazily once per
// schema object, keyed by both key and alias — turns each subsequent lookup into an O(1)
// Map access. Safe under the "no alias collides with another field's key/alias" invariant
// enforced by queryFields.test.ts.
const fieldIndexCache = new WeakMap<QuerySchema<unknown>, Map<string, FieldDef<unknown>>>();

function fieldIndex<T>(schema: QuerySchema<T>): Map<string, FieldDef<T>> {
  const cached = fieldIndexCache.get(schema as QuerySchema<unknown>);
  if (cached) return cached as Map<string, FieldDef<T>>;
  const index = new Map<string, FieldDef<T>>();
  for (const f of schema.fields) {
    index.set(f.key, f);
    for (const alias of f.aliases ?? []) index.set(alias, f);
  }
  fieldIndexCache.set(schema as QuerySchema<unknown>, index as Map<string, FieldDef<unknown>>);
  return index;
}

function resolveField<T>(schema: QuerySchema<T>, name: string): FieldDef<T> | undefined {
  return fieldIndex(schema).get(name.toLowerCase());
}

// Same idea for the handful of fields a bare (non-field) word searches: resolved once per
// schema instead of re-scanning schema.fields per default field per item.
const defaultTextFieldsCache = new WeakMap<QuerySchema<unknown>, FieldDef<unknown>[]>();

function defaultTextFieldDefs<T>(schema: QuerySchema<T>): FieldDef<T>[] {
  const cached = defaultTextFieldsCache.get(schema as QuerySchema<unknown>);
  if (cached) return cached as FieldDef<T>[];
  const index = fieldIndex(schema);
  const defs = schema.defaultTextFields.map((key) => index.get(key)).filter((d): d is FieldDef<T> => !!d);
  defaultTextFieldsCache.set(schema as QuerySchema<unknown>, defs as FieldDef<unknown>[]);
  return defs;
}

function hasWildcard(value: string): boolean {
  return value.includes('*') || value.includes('?');
}

// "*" -> any run of characters, "?" -> any single character. A pattern with a wildcard
// matches the *whole* value (so "char*" means "starts with", not "contains" — bookend
// with "*" on both sides for a contains-style match, e.g. "*char*").
//
// This is a two-pointer matcher (the standard "wildcard matching" algorithm), not a
// backtracking RegExp: a pattern built from adjacent "*" segments (e.g. "a*a*a*a*a*b")
// tested against a long non-matching value is a classic catastrophic-backtracking shape
// for a naive `.*` RegExp translation — it could hang the tab indefinitely on ordinary
// user keystrokes. This algorithm is bounded to O(pattern.length * value.length) with no
// backtracking blowup, at the cost of no per-pattern compile step to cache.
function globMatch(pattern: string, value: string): boolean {
  const p = pattern.toLowerCase();
  const s = value.toLowerCase();
  let pi = 0;
  let si = 0;
  let starIdx = -1;
  let matchIdx = 0;
  while (si < s.length) {
    if (pi < p.length && (p[pi] === '?' || p[pi] === s[si])) {
      pi++;
      si++;
    } else if (pi < p.length && p[pi] === '*') {
      starIdx = pi;
      matchIdx = si;
      pi++;
    } else if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx++;
      si = matchIdx;
    } else {
      return false;
    }
  }
  while (pi < p.length && p[pi] === '*') pi++;
  return pi === p.length;
}

function textMatches(haystack: string, needle: string): boolean {
  if (hasWildcard(needle)) return globMatch(needle, haystack);
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function compareNumbers(actual: number, op: ClauseOp, value: string, def: FieldDef<unknown>): boolean {
  if (value.includes('..')) {
    const [loRaw, hiRaw] = value.split('..');
    const lo = def.toRaw ? def.toRaw(Number(loRaw)) : Number(loRaw);
    const hi = def.toRaw ? def.toRaw(Number(hiRaw)) : Number(hiRaw);
    return actual >= lo && actual <= hi;
  }
  const cmp = def.toRaw ? def.toRaw(Number(value)) : Number(value);
  if (Number.isNaN(cmp)) return false;
  switch (op) {
    case ':':
    case '=':
      return actual === cmp;
    case '!=':
      return actual !== cmp;
    case '>':
      return actual > cmp;
    case '>=':
      return actual >= cmp;
    case '<':
      return actual < cmp;
    case '<=':
      return actual <= cmp;
  }
}

function evalClause<T>(node: { field: string; op: ClauseOp; value: string }, item: T, schema: QuerySchema<T>): boolean {
  const def = resolveField(schema, node.field);
  if (!def) return false; // unknown field never matches
  const raw = def.get(item);
  switch (def.type) {
    case 'text': {
      // A field with no value has nothing to match against, so a positive clause never
      // matches it — that keeps "field:*" meaning "has a value" (as it already does for
      // list fields, where `some()` over an empty array is false, and as `number` does by
      // returning false on null). "!=" still holds: a card with no Pokémon genuinely isn't
      // the one named. Treating null as "" instead would make `pokemon:*` match Trainer
      // and Energy cards, which have no Pokémon at all.
      if (raw == null) return node.op === '!=';
      return (node.op === '!=') !== textMatches(String(raw), node.value);
    }
    case 'list': {
      const list = (raw as string[] | null) ?? [];
      const has = hasWildcard(node.value)
        ? list.some((v) => globMatch(node.value, v))
        : list.some((v) => v.toLowerCase() === node.value.toLowerCase());
      return node.op === '!=' ? !has : has;
    }
    case 'boolean': {
      const val = !!raw;
      const want = /^(true|yes|1)$/i.test(node.value);
      return node.op === '!=' ? val !== want : val === want;
    }
    case 'number': {
      if (raw == null) return false;
      return compareNumbers(Number(raw), node.op, node.value, def as FieldDef<unknown>);
    }
    case 'date': {
      // Same rule as text: an absent date isn't "earliest", it's unknown, so it must not
      // satisfy a comparison — as "" would, being lexicographically below every real date.
      if (raw == null) return node.op === '!=';
      const s = String(raw);
      switch (node.op) {
        case '!=':
          return s !== node.value;
        case '>':
          return s > node.value;
        case '>=':
          return s >= node.value;
        case '<':
          return s < node.value;
        case '<=':
          return s <= node.value;
        default:
          return s === node.value || textMatches(s, node.value);
      }
    }
  }
}

function evalNode<T>(node: Node, item: T, schema: QuerySchema<T>): boolean {
  switch (node.kind) {
    case 'and':
      return node.children.every((c) => evalNode(c, item, schema));
    case 'or':
      return node.children.some((c) => evalNode(c, item, schema));
    case 'not':
      return !evalNode(node.child, item, schema);
    case 'clause':
      return evalClause(node, item, schema);
    case 'text':
      return defaultTextFieldDefs(schema).some((def) => {
        const v = def.get(item);
        if (Array.isArray(v)) return v.some((x) => textMatches(x, node.value));
        return v != null && textMatches(String(v), node.value);
      });
  }
}

export function matchesQuery<T>(query: Node, item: T, schema: QuerySchema<T>): boolean {
  return evalNode(query, item, schema);
}

// A query "uses advanced syntax" once it has a field clause, negation, grouping, a
// wildcard, or a boolean keyword — plain words stay on the fast, server-paginated search
// path (the server's search is a plain substring match, which can't express any of these).
export function isAdvancedQuery(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (/[():><*?]|!=/.test(trimmed)) return true;
  if (/\b(AND|OR|NOT)\b/i.test(trimmed)) return true;
  if (/^!/.test(trimmed) || / !/.test(trimmed)) return true;
  return false;
}
