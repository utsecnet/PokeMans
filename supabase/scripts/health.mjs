// Prints price health and database usage, the same two reads the admin dashboard uses.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = (f) => Object.fromEntries(
  fs.readFileSync(f, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const e = { ...env('client/.env.local'), ...env('supabase/.env') };
const db = createClient(e.VITE_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: health } = await db.rpc('price_health');
const { data: usage } = await db.rpc('database_usage');
console.log('   PRICE HEALTH');
for (const [k, v] of Object.entries(health ?? {})) {
  console.log('     ' + k.padEnd(18) + (typeof v === 'number' ? v.toLocaleString() : v));
}
console.log('');
console.log(`   DATABASE  ${usage.pretty} of ${usage.limitPretty}  (${usage.pctUsed}%)`);
for (const t of usage.tables.slice(0, 6)) console.log('     ' + t.name.padEnd(24) + t.pretty);
