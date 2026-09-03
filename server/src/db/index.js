import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'pokedex.sqlite');
export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

export function upsert(table, row, conflictColumns) {
  const columns = Object.keys(row);
  const placeholders = columns.map((c) => `@${c}`).join(', ');
  const updates = columns
    .filter((c) => !conflictColumns.includes(c))
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');

  const sql = `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT(${conflictColumns.join(', ')}) DO UPDATE SET ${updates}
  `;

  const stmt = db.prepare(sql);
  const params = {};
  for (const c of columns) {
    params[c] = row[c] === undefined ? null : row[c];
  }
  stmt.run(params);
}

export function all(sql, params = {}) {
  return db.prepare(sql).all(params);
}

export function get(sql, params = {}) {
  return db.prepare(sql).get(params);
}

export function run(sql, params = {}) {
  return db.prepare(sql).run(params);
}
