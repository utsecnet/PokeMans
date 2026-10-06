// Invokes an Edge Function with the service key, for testing from this machine.
//   node supabase/scripts/invoke.mjs <function> ['{"json":"body"}']
import fs from 'node:fs';
const env = (f) => Object.fromEntries(
  fs.readFileSync(f, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const e = { ...env('client/.env.local'), ...env('supabase/.env') };
const name = process.argv[2];
const body = process.argv[3] ?? '{}';
const t0 = Date.now();
const res = await fetch(`${e.VITE_SUPABASE_URL}/functions/v1/${name}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
  body,
});
const text = await res.text();
console.log(`   HTTP ${res.status}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
try { console.log('   ' + JSON.stringify(JSON.parse(text), null, 2).split('\n').join('\n   ')); }
catch { console.log('   ' + text.slice(0, 500)); }
