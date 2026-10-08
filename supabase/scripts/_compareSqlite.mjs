import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = (f) => Object.fromEntries(fs.readFileSync(f,'utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trimStart().startsWith('#'))
  .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]));
const e = { ...env('client/.env.local'), ...env('supabase/.env') };
const db = createClient(e.VITE_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });

const cat = new DatabaseSync('server/data/catalog.sqlite', { readOnly: true });
const per = new DatabaseSync('server/data/personal.sqlite', { readOnly: true });
const localCount = (h, t) => { try { return h.prepare(`select count(*) as n from "${t}"`).get().n; } catch { return null; } };
const remoteCount = async (t) => {
  const { count, error } = await db.from(t).select('*', { count: 'exact', head: true });
  return error ? `— ${error.message.slice(0,34)}` : count;
};

console.log('   CATALOGUE');
for (const t of ['pokemon','types','stats','abilities','evolutions','pokemon_types','pokemon_abilities',
                 'tcg_series','tcg_sets','tcg_cards','tcg_card_variants','tcg_card_types','tcg_card_pokemon']) {
  const l = localCount(cat, t), r = await remoteCount(t);
  const flag = l === r ? '' : '   <-- differs';
  console.log(`     ${t.padEnd(22)}local ${String(l).padStart(7)}   supabase ${String(r).padStart(7)}${flag}`);
}
console.log('');
console.log('   PERSONAL');
for (const [lt, rt] of [['collection_boxes','collection_boxes'],['collection_entries','collection_entries'],
                        ['want_lists','want_lists'],['want_list_entries','want_list_entries'],
                        ['settings','user_settings'],['card_price_history','price_point'],
                        ['fx_rates',null],['linked_accounts',null]]) {
  const l = localCount(per, lt);
  const r = rt ? await remoteCount(rt) : 'retired';
  console.log(`     ${lt.padEnd(22)}local ${String(l).padStart(7)}   supabase ${String(r).padStart(9)}`);
}
cat.close(); per.close();
