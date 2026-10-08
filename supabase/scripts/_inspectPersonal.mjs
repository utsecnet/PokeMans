import { DatabaseSync } from 'node:sqlite';
const per = new DatabaseSync('server/data/personal.sqlite', { readOnly: true });
const show = (t) => {
  const cols = per.prepare(`pragma table_info("${t}")`).all().map(c => c.name);
  console.log(`   ${t}  [${cols.join(', ')}]`);
  for (const r of per.prepare(`select * from "${t}" limit 6`).all()) {
    console.log('     ' + JSON.stringify(r));
  }
  console.log('');
};
for (const t of ['collection_boxes','want_lists','settings']) show(t);
console.log('   collection_entries (first 4):');
for (const r of per.prepare('select * from collection_entries limit 4').all()) console.log('     ' + JSON.stringify(r));
console.log('');
console.log('   want_list_entries (first 4):');
for (const r of per.prepare('select * from want_list_entries limit 4').all()) console.log('     ' + JSON.stringify(r));
per.close();
