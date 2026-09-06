// Pure logic behind the advanced search bar's autocomplete — split out from
// AdvancedSearchInput.tsx so it can be unit-tested directly under Node (a .tsx file's JSX
// can't be parsed by a plain type-stripping run, only by a real build), and so the
// component itself stays focused on rendering/DOM concerns.
import type { QuerySchema } from './queryLanguage.ts';

export interface Suggestion {
  label: string;
  insertText: string;
  hint?: string;
}

export function currentToken(value: string, cursor: number): { start: number; text: string } {
  let start = cursor;
  while (start > 0 && !/[\s()]/.test(value[start - 1])) start--;
  return { start, text: value.slice(start, cursor) };
}

export const CLAUSE_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)(:|=|!=|>=|<=|>|<)(.*)$/;

export function computeSuggestions<T>(token: string, schema: QuerySchema<T>): Suggestion[] {
  const clauseMatch = token.match(CLAUSE_RE);
  if (clauseMatch) {
    const [, fieldRaw, op, partial] = clauseMatch;
    const def = schema.fields.find(
      (f) => f.key === fieldRaw.toLowerCase() || f.aliases?.includes(fieldRaw.toLowerCase()),
    );
    if (!def?.suggestions) return [];
    const seen = new Set<string>();
    return def.suggestions
      .filter((v) => {
        const key = v.toLowerCase();
        if (!key.includes(partial.toLowerCase()) || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12)
      .map((v) => ({
        label: v,
        insertText: `${fieldRaw}${op}${v.includes(' ') ? `"${v}"` : v} `,
      }));
  }

  const negatePrefix = token.startsWith('!') ? '!' : '';
  const partial = token.slice(negatePrefix.length).toLowerCase();
  // Match against aliases too (e.g. "atk" for "attack"), not just each field's primary
  // key — the parser already accepts either, autocomplete should help you find both.
  const fieldSugs = schema.fields.flatMap((f) =>
    [f.key, ...(f.aliases ?? [])]
      .filter((name) => name.startsWith(partial))
      .map((name) => ({
        label: `${negatePrefix}${name}:`,
        insertText: `${negatePrefix}${name}:`,
        hint: f.label,
      })),
  );
  // A "!" negation prefix only makes sense on a field clause, not a bare AND/OR/NOT
  // keyword, so keyword suggestions are skipped once one's been typed.
  const keywordSugs = negatePrefix
    ? []
    : (['AND', 'OR', 'NOT'] as const)
        .filter((k) => k.toLowerCase().startsWith(partial))
        .map((k) => ({ label: k, insertText: `${k} `, hint: 'operator' }));
  return [...fieldSugs, ...keywordSugs].slice(0, 12);
}

// Splices an accepted suggestion into the text at the token being completed.
export function applySuggestion(
  value: string,
  tokenStart: number,
  cursor: number,
  suggestion: Suggestion,
): { text: string; cursor: number } {
  const text = value.slice(0, tokenStart) + suggestion.insertText + value.slice(cursor);
  return { text, cursor: tokenStart + suggestion.insertText.length };
}
