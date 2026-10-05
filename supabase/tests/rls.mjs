/**
 * Does row level security actually hold?
 *
 * Checks that a signed-out caller reaches nothing, that a user can keep their own
 * collection, and that a second user cannot read, rename, delete or write into the
 * first one's.
 *
 * Two *real* accounts, because since migration 0014 a browsing session cannot create a
 * collection at all — proving one user's rows are hidden from another needs two users who
 * can own rows in the first place.
 */
import { anonClient, browsingSession, createTestUser, reporter } from './_helpers.mjs';

const { check, finish } = reporter();

const A = await createTestUser();
const B = await createTestUser();
const browsing = await browsingSession();
const out = anonClient(); // never signed in

// ---------------------------------------------------------------- signed out
{
  const cards = await out.from('tcg_cards').select('id').limit(1);
  check('signed out cannot read the catalogue', cards.error !== null || cards.data?.length === 0,
    cards.error ? cards.error.code : `${cards.data?.length} rows`);

  const boxes = await out.from('collection_boxes').select('id').limit(1);
  check('signed out cannot read collections', boxes.error !== null || boxes.data?.length === 0,
    boxes.error ? boxes.error.code : `${boxes.data?.length} rows`);

  const roles = await out.from('user_roles').select('user_id').limit(1);
  check('signed out cannot read user_roles', roles.error !== null || roles.data?.length === 0,
    roles.error ? roles.error.code : `${roles.data?.length} rows`);
}

// ---------------------------------------------------------------- browsing visitor
{
  const cat = await browsing.client.from('tcg_cards').select('id,name').eq('id', 'base1-4').single();
  check('a browsing visitor can read cards', cat.data?.name === 'Charizard', cat.error?.message ?? cat.data?.name);

  // The rule from 0014: browsing is open, collecting is not.
  const nope = await browsing.client.from('collection_boxes').insert({ name: 'Browsing cannot' }).select();
  check('a browsing visitor cannot collect', nope.error !== null, nope.error?.code ?? 'ALLOWED — BAD');
}

// ---------------------------------------------------------------- user A
const made = await A.client.from('collection_boxes').insert({ name: 'RLS probe A' }).select().single();
check('A can create a collection', !made.error, made.error?.message ?? `box ${made.data?.id}`);
const boxId = made.data?.id;

{
  const mine = await A.client.from('collection_boxes').select('id,name,user_id');
  check('A can read it back', mine.data?.length === 1, `${mine.data?.length} rows`);
  check('the row is stamped with A', mine.data?.[0]?.user_id === A.user.id);

  const cat = await A.client.from('tcg_cards').select('id,name').eq('id', 'base1-4').single();
  check('A can read the shared catalogue', cat.data?.name === 'Charizard', cat.error?.message ?? `base1-4 = ${cat.data?.name}`);

  const countable = await A.client.from('tcg_cards').select('*', { count: 'exact', head: true });
  check('A sees the whole catalogue', (countable.count ?? 0) > 20000, `${countable.count} cards`);

  const write = await A.client.from('tcg_cards').update({ name: 'tampered' }).eq('id', 'base1-4').select();
  check('A cannot write to the catalogue', write.error !== null || write.data?.length === 0,
    write.error ? write.error.code : `${write.data?.length} rows changed`);

  const roles = await A.client.from('user_roles').select('user_id').limit(1);
  check('A cannot read user_roles', roles.error !== null || roles.data?.length === 0,
    roles.error ? roles.error.code : `${roles.data?.length} rows`);

  const admin = await A.client.rpc('is_admin');
  check('A is not admin', admin.data === false, `is_admin() = ${admin.data}`);
}

// ---------------------------------------------------------------- user B
{
  const all = await B.client.from('collection_boxes').select('id,name');
  check("B sees none of A's collections", all.data?.length === 0, `${all.data?.length} rows`);

  const direct = await B.client.from('collection_boxes').select('id,name').eq('id', boxId);
  check("B cannot fetch A's box by its id", direct.data?.length === 0, `${direct.data?.length} rows`);

  const steal = await B.client.from('collection_boxes').update({ name: 'stolen' }).eq('id', boxId).select();
  check("B cannot rename A's box", steal.error !== null || steal.data?.length === 0,
    steal.error ? steal.error.code : `${steal.data?.length} rows changed`);

  const wipe = await B.client.from('collection_boxes').delete().eq('id', boxId).select();
  check("B cannot delete A's box", wipe.error !== null || wipe.data?.length === 0,
    wipe.error ? wipe.error.code : `${wipe.data?.length} rows deleted`);

  // The composite foreign key refuses this even if a policy were wrong.
  const plant = await B.client.from('collection_entries').insert({ box_id: boxId, card_id: 'base1-4' }).select();
  check("B cannot file a card into A's box", plant.error !== null, plant.error?.code ?? 'INSERT SUCCEEDED');

  const forge = await B.client.from('collection_boxes').insert({ name: 'forged', user_id: A.user.id }).select();
  check('B cannot create a row owned by A', forge.error !== null, forge.error?.code ?? 'INSERT SUCCEEDED');
}

// ---------------------------------------------------------------- still there?
{
  const after = await A.client.from('collection_boxes').select('id,name').eq('id', boxId);
  check("A's box survived all that, unrenamed", after.data?.[0]?.name === 'RLS probe A', after.data?.[0]?.name ?? 'gone');
}

const gone = await A.client.from('collection_boxes').delete().eq('id', boxId).select();
check('A can delete their own box', gone.data?.length === 1, `${gone.data?.length} rows`);

await A.remove();
await B.remove();
finish();
