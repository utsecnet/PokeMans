/**
 * Does a collection behave the way the collection page expects?
 *
 * Creates a box, files copies, reads it back through both functions, then deletes it.
 * Covers the distinctions that are easy to get wrong: distinct cards against total
 * copies, an unknown box, and whether deleting a box takes its entries with it.
 */
import { createTestUser, reporter } from './_helpers.mjs';

const { check, finish } = reporter();

// A real account: collecting needs one since migration 0014.
const owner = await createTestUser();
const sb = owner.client;


const { data: box, error: e1 } = await sb.from('collection_boxes').insert({ name: 'Test binder' }).select().single();
check('create a collection', !e1, e1?.message ?? `id ${box?.id}`);

const { error: e2 } = await sb.from('collection_entries').insert([
  { box_id: box.id, card_id: 'base1-4' },
  { box_id: box.id, card_id: 'base1-4' },
  { box_id: box.id, card_id: 'base1-2' },
]);
check('file 3 copies (2 of one card)', !e2, e2?.message ?? '');

const { data: ov, error: e3 } = await sb.rpc('collection_overview');
const b = ov?.boxes?.[0];
check('overview returns the box', !e3 && !!b, e3?.message ?? '');
check('cardCount counts distinct cards', b?.cardCount === 2, `cardCount=${b?.cardCount}`);
check('totalQuantity counts copies', b?.totalQuantity === 3, `totalQuantity=${b?.totalQuantity}`);
check('preview lists card ids', Array.isArray(b?.preview) && b.preview.length === 2, JSON.stringify(b?.preview));
// No printing recorded means no price, by design: the same card in Unlimited and 1st
// Edition differ several-fold, so a guess would be a number with no meaning.
check('copies without a printing are unpriced', b?.unpriced === 3, `unpriced=${b?.unpriced}`);
check('valueUsd is 0, not null', b?.valueUsd === 0, `valueUsd=${JSON.stringify(b?.valueUsd)}`);

const { data: det, error: e4 } = await sb.rpc('collection_box', { p_box_id: box.id });
check('box detail joins the catalogue', !e4 && det?.entries?.length === 3, e4?.message ?? `${det?.entries?.length} entries`);
const first = det?.entries?.[0];
check('entry carries card details', Boolean(first?.name && first?.setName), first ? `${first.name} / ${first.setName}` : '');
check('entry carries printings', Array.isArray(first?.printings) && first.printings.length > 0,
  JSON.stringify(first?.printings?.map((p) => p.type)));

const { data: missing } = await sb.rpc('collection_box', { p_box_id: 999999 });
check('unknown box returns null', missing === null, JSON.stringify(missing));

await sb.from('collection_boxes').delete().eq('id', box.id);
const { data: after } = await sb.rpc('collection_overview');
check('delete cascades to entries', after.boxes.length === 0, `${after.boxes.length} boxes left`);
await owner.remove();
finish();
