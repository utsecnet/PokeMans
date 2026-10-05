/**
 * Do want lists behave the way the want-list page expects?
 *
 * Covers the distinction that makes the feature work: a card removed from a live list is
 * marked excluded rather than deleted, so the next refresh does not put it straight back.
 */
import { createTestUser, reporter } from './_helpers.mjs';

const { check, finish } = reporter();

const owner = await createTestUser();
const sb = owner.client;


const { data: list, error: e1 } = await sb.from('want_lists')
  .insert({ name: 'Base set chase', color: '#ef4444' }).select().single();
check('create a want list', !e1, e1?.message ?? `id ${list?.id}`);

// `state` is spelled out on every row on purpose. PostgREST builds one INSERT over the
// union of keys in a batch, so a row that omits a column another row sets gets NULL
// rather than the column default -- which here is a not-null violation, not a default.
const { error: e2 } = await sb.from('want_list_entries').insert([
  { list_id: list.id, card_id: 'base1-4',  state: 'want' },
  { list_id: list.id, card_id: 'base1-2',  state: 'want' },
  { list_id: list.id, card_id: 'base1-15', state: 'excluded' },
]);
check('add 2 wanted + 1 excluded', !e2, e2?.message ?? '');

// Own one of them, so the progress counts have something to find.
const { data: box } = await sb.from('collection_boxes').insert({ name: 'Wants test box' }).select().single();
await sb.from('collection_entries').insert({ box_id: box.id, card_id: 'base1-4' });

const { data: ov, error: e3 } = await sb.rpc('want_lists_overview');
const l = ov?.lists?.[0];
check('overview returns the list', !e3 && !!l, e3?.message ?? '');
check('wantedCount excludes excluded', l?.wantedCount === 2, `wantedCount=${l?.wantedCount}`);
check('ownedCount sees the owned card', l?.ownedCount === 1, `ownedCount=${l?.ownedCount}`);
check('preview carries owned flags', JSON.stringify(l?.preview?.map((p) => p.owned)) === '[true,false]',
  JSON.stringify(l?.preview));

const { data: det, error: e4 } = await sb.rpc('want_list', { p_list_id: list.id });
check('detail returns wanted cards only', !e4 && det?.cards?.length === 2, e4?.message ?? `${det?.cards?.length} cards`);
const owned = det?.cards?.find((c) => c.id === 'base1-4');
check('wanted card shows which box holds it', owned?.inBoxes?.[0]?.boxName === 'Wants test box',
  JSON.stringify(owned?.inBoxes?.map((b) => b.boxName)));
const notOwned = det?.cards?.find((c) => c.id === 'base1-2');
check('unowned card has no boxes', Array.isArray(notOwned?.inBoxes) && notOwned.inBoxes.length === 0, '');
check('detail joins the catalogue', Boolean(owned?.name && owned?.setName), `${owned?.name} / ${owned?.setName}`);

const { data: byCard, error: e5 } = await sb.rpc('wants_by_card');
check('by-card maps cards to lists', !e5 && byCard?.byCard?.['base1-4']?.[0]?.listName === 'Base set chase',
  e5?.message ?? JSON.stringify(Object.keys(byCard?.byCard ?? {})));
check('by-card omits excluded cards', !('base1-15' in (byCard?.byCard ?? {})), '');

const { data: missing } = await sb.rpc('want_list', { p_list_id: 999999 });
check('unknown list returns null', missing === null, JSON.stringify(missing));

await sb.from('want_lists').delete().eq('id', list.id);
await sb.from('collection_boxes').delete().eq('id', box.id);
const { data: after } = await sb.rpc('want_lists_overview');
check('delete cascades to entries', after.lists.length === 0, `${after.lists.length} lists left`);
await owner.remove();
finish();
