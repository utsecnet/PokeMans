// A sort chain is a comma-separated list of field:dir pairs, e.g. "releaseDate:asc,name:desc"
// — each is applied in order, so a later field only breaks ties left by the one before it.
// Shared by the card and Pokémon list endpoints so both sort the same way and the sidebar
// can offer the same ordered-rule editor for either.

export function parseSortChain(raw, columns, fallback) {
  if (!raw) return fallback;
  const parsed = String(raw)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [field, dir] = part.split(':');
      return { field, dir: dir === 'desc' ? 'DESC' : 'ASC' };
    })
    .filter((entry) => columns[entry.field]);
  return parsed.length ? parsed : fallback;
}

export function buildOrderByClause(chain, columns, tiebreakers = []) {
  const terms = chain.flatMap(({ field, dir }) => {
    const col = columns[field];
    // Push NULLs to the end regardless of direction (SQLite sorts NULL first in ASC by
    // default, which would otherwise float incomplete rows to the top).
    return [`(${col} IS NULL)`, `${col} ${dir}`];
  });
  terms.push(...tiebreakers);
  return terms.join(', ');
}
