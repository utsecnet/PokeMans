// Pulls the catalogue out to local JSON so the mapping spike can run offline against it.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const env = (f) => Object.fromEntries(
  fs.readFileSync(f, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const e = { ...env('client/.env.local'), ...env('supabase/.env') };
const db = createClient(e.VITE_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function all(table, cols) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await db.from(table).select(cols).range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

const OUT = process.argv[2] || '.';
const sets  = await all('tcg_sets', 'id,name,series,release_date');
const cards = await all('tcg_cards', 'id,name,number,set_id,set_name');
const vars  = await all('tcg_card_variants', 'card_id,position,type');
fs.writeFileSync(path.join(OUT, 'my_sets.json'), JSON.stringify(sets));
fs.writeFileSync(path.join(OUT, 'my_cards.json'), JSON.stringify(cards));
fs.writeFileSync(path.join(OUT, 'my_vars.json'), JSON.stringify(vars));
console.log(`   sets: ${sets.length} | cards: ${cards.length} | variants: ${vars.length}`);
