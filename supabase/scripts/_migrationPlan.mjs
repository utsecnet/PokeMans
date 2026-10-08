import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = (f) => Object.fromEntries(fs.readFileSync(f,'utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trimStart().startsWith('#'))
  .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]));
const e = { ...env('client/.env.local'), ...env('supabase/.env') };
const db = createClient(e.VITE_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const per = new DatabaseSync('server/data/personal.sqlite', { readOnly: true });

const localEntries = per.prepare('select box_id, card_id, variant_position from collection_entries').all();
const localCards = new Set(localEntries.map(r => r.card_id));
const { data: remote } = await db.from('collection_entries').select('card_id,box_id');
const remoteCards = new Set((remote??[]).map(r => r.card_id));
const overlap = [...remoteCards].filter(c => localCards.has(c));

console.log('   local collection cards: ' + localCards.size + ' distinct, ' + localEntries.length + ' copies');
console.log('   supabase cards:         ' + [...remoteCards].join(', '));
console.log('   overlap:                ' + (overlap.length ? overlap.join(', ') : 'none'));
console.log('');
console.log('   local boxes and their contents:');
for (const b of per.prepare('select * from collection_boxes').all()) {
  const n = per.prepare('select count(*) as n from collection_entries where box_id = ?').get(b.id).n;
  console.log(`     ${String(b.id).padStart(3)}  ${b.name.padEnd(12)} ${b.type}  ${n} copies`);
}
console.log('   local want lists:');
for (const l of per.prepare('select * from want_lists').all()) {
  const n = per.prepare('select count(*) as n from want_list_entries where list_id = ?').get(l.id).n;
  console.log(`     ${String(l.id).padStart(3)}  ${l.name.padEnd(18)} ${n} entries  query=${JSON.stringify(l.query)}`);
}
console.log('');
console.log('   leftover test accounts and what they hold:');
const { data: users } = await db.auth.admin.listUsers({ page:1, perPage:50 });
for (const u of (users?.users ?? []).filter(u => (u.email ?? '').includes('pokemans.invalid'))) {
  const counts = [];
  for (const t of ['collection_boxes','collection_entries','want_lists','want_list_entries','user_settings']) {
    const { count } = await db.from(t).select('*', { count:'exact', head:true }).eq('user_id', u.id);
    if (count) counts.push(`${t}=${count}`);
  }
  console.log(`     ${u.id}  ${counts.length ? counts.join(' ') : 'empty'}`);
}
per.close();
