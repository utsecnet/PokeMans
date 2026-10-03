/**
 * Want lists, on Supabase.
 *
 * Reads go through three Postgres functions; writes are plain table operations under the
 * policies from migration 0001.
 *
 * A want list entry has a `state`: 'want' for a card someone is looking for, 'excluded'
 * for one they have deliberately taken off a live list. An excluded card stays as a row,
 * because that is how the list remembers not to re-add it the next time its query runs.
 * Every read here filters on 'want'; only refreshWantList cares about the difference.
 */
import type { WantList, WantListDetail, WantsByCard, CardFilters } from '../types';
import { supabase } from './supabase';
import { localCard, localiseCards } from './localImages';
import { fetchCards, cardFilterParams } from './api';

function fail(context: string, error: { message: string; code?: string } | null): never {
  throw new Error(error?.code === '23505'
    ? `${context}: that name is already taken.`
    : `${context}: ${error?.message ?? 'unknown error'}`);
}

export async function fetchWantLists(): Promise<{ lists: WantList[] }> {
  const { data, error } = await supabase.rpc('want_lists_overview');
  if (error) fail('Could not load want lists', error);
  // Postgres returns card ids; WantList wants local paths. Two different shapes under one
  // name, so the raw one is spelled out rather than cast over.
  type RawList = Omit<WantList, 'preview'> & { preview: { cardId: string; owned: boolean }[] };
  const raw = data as { lists: RawList[] };

  const lists: WantList[] = raw.lists.map((list) => ({
    ...list,
    // The owned flag is what greys a card out on the tile, so it travels with the path.
    preview: list.preview
      .map((p) => ({ url: localCard(p.cardId), owned: p.owned }))
      .filter((p): p is { url: string; owned: boolean } => p.url !== null),
  })) as WantList[];

  return { lists };
}

export async function fetchWantList(listId: number): Promise<WantListDetail> {
  // A live list catches up before it is read, so what appears is current. The server did
  // this inside the GET; here it is an explicit step, because a function that only reads
  // cannot write the new rows.
  const { data: meta } = await supabase
    .from('want_lists').select('live,query').eq('id', listId).single();
  if (meta?.live && meta.query) await refreshWantList(listId);

  const { data, error } = await supabase.rpc('want_list', { p_list_id: listId });
  if (error) fail('Could not load that want list', error);
  if (!data) throw new Error('Want list not found');
  const detail = data as WantListDetail;
  localiseCards(detail.cards as unknown as Record<string, unknown>[]);
  return detail;
}

export async function fetchWantsByCard(): Promise<{ byCard: WantsByCard }> {
  const { data, error } = await supabase.rpc('wants_by_card');
  if (error) fail('Could not load want lists', error);
  return data as { byCard: WantsByCard };
}

export async function createWantList(
  name: string,
  color: string | null = null,
  query: string | null = null,
  live = false,
): Promise<WantList & { seeded: number }> {
  const { data, error } = await supabase
    .from('want_lists')
    .insert({ name, color, query, live })
    .select()
    .single();
  if (error) fail('Could not create that want list', error);
  // A list built from a filter starts with everything that filter currently matches —
  // `seeded` is how many that was, which the page reports back.
  const seeded = query ? (await refreshWantList(data.id)).added : 0;
  return { ...data, wantedCount: seeded, ownedCount: 0, preview: [], seeded } as unknown as
    WantList & { seeded: number };
}

export async function updateWantList(
  listId: number,
  patch: { name?: string; color?: string | null; live?: boolean; query?: string | null },
): Promise<WantList & { added: number }> {
  const { data, error } = await supabase
    .from('want_lists').update(patch).eq('id', listId).select().single();
  if (error) fail('Could not update that want list', error);
  // Turning a list live catches it up at once rather than waiting to be opened, so the
  // count the page shows after the toggle is the real one.
  const added = data.live && data.query ? (await refreshWantList(listId)).added : 0;
  const { count } = await supabase
    .from('want_list_entries')
    .select('*', { count: 'exact', head: true })
    .eq('list_id', listId)
    .eq('state', 'want');
  return { ...data, wantedCount: count ?? 0, added } as unknown as WantList & { added: number };
}

export async function deleteWantList(listId: number): Promise<void> {
  const { error } = await supabase.from('want_lists').delete().eq('id', listId);
  if (error) fail('Could not delete that want list', error);
}

/**
 * Re-runs a list's stored filter and absorbs anything new that matches.
 *
 * Only ever adds. A card already on the list keeps its place, and one the user explicitly
 * removed stays removed — that is what `state = 'excluded'` is for, and skipping those is
 * the whole reason a removal sticks on a list that re-runs itself.
 */
export async function refreshWantList(listId: number): Promise<WantList & { added: number }> {
  const { data: list, error: readErr } = await supabase
    .from('want_lists').select('*').eq('id', listId).single();
  if (readErr) fail('Could not refresh that want list', readErr);
  if (!list?.query) return { ...list, added: 0 } as WantList & { added: number };

  const filters = filtersFromQuery(list.query);
  // Everything the filter matches, not a page of it: the list is the whole match set.
  const matches = await fetchCards({ pageSize: 25000, filters });

  const { data: existing } = await supabase
    .from('want_list_entries').select('card_id').eq('list_id', listId);
  const known = new Set((existing ?? []).map((r) => r.card_id));

  const fresh = matches.items
    .filter((c) => !known.has(c.id))
    .map((c) => ({ list_id: listId, card_id: c.id, state: 'want' }));

  if (fresh.length > 0) {
    const { error } = await supabase.from('want_list_entries').insert(fresh);
    if (error) fail('Could not refresh that want list', error);
  }
  await supabase
    .from('want_lists')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', listId);

  return { ...list, added: fresh.length } as WantList & { added: number };
}

/**
 * The stored query string, back as filters.
 *
 * cardFilterParams in api.ts writes this; this reads it. The two have to agree, and a
 * list created months ago is parsed by whatever this says today — which is why the
 * serialised form stays a plain query string rather than anything versioned.
 */
function filtersFromQuery(query: string): Partial<CardFilters> {
  const p = new URLSearchParams(query);
  const csv = (k: string) => p.get(k)?.split(',').filter(Boolean) ?? undefined;
  const owned = p.get('owned');
  return {
    search: p.get('search') ?? undefined,
    expansions: csv('expansions'),
    series: csv('series'),
    rarities: csv('rarities'),
    types: csv('types'),
    generations: csv('generations'),
    supertypes: csv('supertypes'),
    illustrators: csv('illustrators'),
    owned: owned === null ? null : owned === 'true',
  };
}

/** Adds one card to a list. Idempotent, and clears a previous exclusion. */
export async function addToWantList(listId: number, cardId: string): Promise<{ cardId: string }> {
  const { error } = await supabase
    .from('want_list_entries')
    .upsert({ list_id: listId, card_id: cardId, state: 'want' }, { onConflict: 'list_id,card_id' });
  if (error) fail('Could not add that card', error);
  return { cardId };
}

/**
 * Takes a card off a list.
 *
 * A list that re-runs its own query marks the card excluded instead of deleting it, so
 * the next refresh does not put it straight back. A fixed list simply drops the row.
 */
export async function removeFromWantList(listId: number, cardId: string): Promise<void> {
  const { data: list } = await supabase.from('want_lists').select('live').eq('id', listId).single();
  const { error } = list?.live
    ? await supabase
        .from('want_list_entries')
        .update({ state: 'excluded' })
        .eq('list_id', listId)
        .eq('card_id', cardId)
    : await supabase
        .from('want_list_entries')
        .delete()
        .eq('list_id', listId)
        .eq('card_id', cardId);
  if (error) fail('Could not remove that card', error);
}

export { cardFilterParams };
