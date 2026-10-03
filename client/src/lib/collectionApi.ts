/**
 * Collections, on Supabase.
 *
 * Reads go through two Postgres functions; writes are plain table operations, because the
 * policies from migration 0001 already confine them to the caller's own rows. Nothing here
 * sends a user id — row level security supplies it, and `user_id` defaults to auth.uid()
 * on insert.
 *
 * These are multi-step rather than transactional. Filing three copies is three inserts;
 * if the connection dies between them, two copies are filed. For a personal collection
 * that is a recoverable annoyance rather than corruption, and the alternative — a
 * stored procedure per operation — is a lot of SQL for the difference. The entry tables
 * carry no invariants across rows that a partial write could break.
 */
import type {
  CollectionBox,
  CollectionBoxDetail,
  CollectionBoxesResponse,
  ContainerType,
} from '../types';
import { supabase } from './supabase';
import { localCard, localiseCards, localCardLarge } from './localImages';
import { withLabels } from './printingLabel';

function fail(context: string, error: { message: string; code?: string } | null): never {
  throw new Error(error?.code === '23505'
    ? `${context}: that name is already taken.`
    : `${context}: ${error?.message ?? 'unknown error'}`);
}

export async function fetchCollectionBoxes(): Promise<CollectionBoxesResponse> {
  const { data, error } = await supabase.rpc('collection_overview');
  if (error) fail('Could not load collections', error);
  const res = data as CollectionBoxesResponse & { boxes: (CollectionBox & { preview: string[] })[] };
  // Postgres returns the card ids; the local file path is the client's business.
  for (const box of res.boxes) {
    box.preview = (box.preview as unknown as string[])
      .map((cardId) => localCard(cardId))
      .filter((u): u is string => u !== null);
  }
  return res;
}

export async function fetchCollectionBox(boxId: number): Promise<CollectionBoxDetail> {
  const { data, error } = await supabase.rpc('collection_box', { p_box_id: boxId });
  if (error) fail('Could not load that collection', error);
  if (!data) throw new Error('Box not found');
  const detail = data as CollectionBoxDetail;
  for (const entry of detail.entries as unknown as Record<string, unknown>[]) {
    entry.printings = withLabels(entry.printings as never[]);
    // The chosen printing's label, which the UI shows beside the card.
    const chosen = (entry.printings as { position: number; label: string }[])
      .find((p) => p.position === entry.variantPosition);
    entry.variantLabel = chosen?.label ?? null;
  }
  localiseCards(detail.entries as unknown as Record<string, unknown>[]);
  for (const entry of detail.entries as unknown as Record<string, unknown>[]) {
    // The entry's own id is the row id, not the card id — localiseCards keys off `id`,
    // so the two image fields are set from cardId explicitly.
    entry.imageSmall = localCard(entry.cardId as string);
    entry.imageLarge = localCardLarge(entry.cardId as string);
  }
  return detail;
}

export async function createCollectionBox(
  name: string,
  type: ContainerType = 'box',
  color: string | null = null,
): Promise<CollectionBox> {
  const { data, error } = await supabase
    .from('collection_boxes')
    .insert({ name, type, color })
    .select()
    .single();
  if (error) fail('Could not create that collection', error);
  // A new box holds nothing, so the counts are known without asking.
  return { ...data, cardCount: 0, totalQuantity: 0, valueUsd: 0, unpriced: 0, preview: [] };
}

async function patchBox(boxId: number, patch: Record<string, unknown>) {
  const { error } = await supabase.from('collection_boxes').update(patch).eq('id', boxId);
  if (error) fail('Could not update that collection', error);
  return { ok: true };
}

export const renameCollectionBox = (boxId: number, name: string) => patchBox(boxId, { name });
export const setCollectionBoxColor = (boxId: number, color: string | null) =>
  patchBox(boxId, { color });
export const setCollectionBoxIcon = (boxId: number, icon: string | null) =>
  patchBox(boxId, { icon });

/** Sets the manual order from the arrangement the page is currently showing. */
export async function reorderCollectionBoxes(ids: number[]): Promise<{ ok: boolean }> {
  // One update per box. An upsert of the whole set would be a single round trip but would
  // need every column, and a partial row would blank the rest.
  for (const [index, id] of ids.entries()) {
    const { error } = await supabase.from('collection_boxes').update({ position: index }).eq('id', id);
    if (error) fail('Could not reorder collections', error);
  }
  return { ok: true };
}

export async function deleteCollectionBox(boxId: number): Promise<{ ok: boolean }> {
  // Entries go with it: collection_entries cascades on the composite foreign key.
  const { error } = await supabase.from('collection_boxes').delete().eq('id', boxId);
  if (error) fail('Could not delete that collection', error);
  return { ok: true };
}

/**
 * Files `delta` more copies of a card, or removes that many when negative.
 *
 * Each copy is its own row, so two of the same card are two rows that can later be told
 * apart by printing. Removal takes the newest copies first, and prefers ones with no
 * printing recorded — deleting a copy whose printing someone took the trouble to name,
 * while an unrecorded one sits beside it, loses the more valuable information.
 */
export async function addToCollection(
  boxId: number,
  cardId: string,
  delta = 1,
): Promise<{ id: number; quantity: number; boxId: number; cardId: string }> {
  if (delta > 0) {
    const rows = Array.from({ length: delta }, () => ({ box_id: boxId, card_id: cardId }));
    const { data, error } = await supabase.from('collection_entries').insert(rows).select('id');
    if (error) fail('Could not add that card', error);
    await rememberLastUsedBox(boxId);
    const { count } = await countCopies(boxId, cardId);
    return { id: data[data.length - 1].id, quantity: count, boxId, cardId };
  }

  if (delta < 0) {
    const { data: existing, error: readErr } = await supabase
      .from('collection_entries')
      .select('id,variant_position')
      .eq('box_id', boxId)
      .eq('card_id', cardId);
    if (readErr) fail('Could not remove that card', readErr);
    const ordered = [...existing].sort((a, b) => {
      const aNamed = a.variant_position != null ? 1 : 0;
      const bNamed = b.variant_position != null ? 1 : 0;
      if (aNamed !== bNamed) return aNamed - bNamed; // unrecorded printings first
      return b.id - a.id;                             // then newest first
    });
    const doomed = ordered.slice(0, Math.min(-delta, ordered.length)).map((r) => r.id);
    if (doomed.length > 0) {
      const { error } = await supabase.from('collection_entries').delete().in('id', doomed);
      if (error) fail('Could not remove that card', error);
    }
  }

  const { count } = await countCopies(boxId, cardId);
  return { id: 0, quantity: count, boxId, cardId };
}

async function countCopies(boxId: number, cardId: string) {
  const { count } = await supabase
    .from('collection_entries')
    .select('*', { count: 'exact', head: true })
    .eq('box_id', boxId)
    .eq('card_id', cardId);
  return { count: count ?? 0 };
}

/** Remembers where the last card went, for one-click filing next time. */
async function rememberLastUsedBox(boxId: number) {
  await supabase
    .from('user_settings')
    .upsert({ key: 'last_used_box_id', value: String(boxId), updated_at: new Date().toISOString() },
            { onConflict: 'user_id,key' });
}

/** Moves one copy to another collection, keeping its printing and filing date. */
export async function moveCollectionEntry(
  entryId: number,
  boxId: number,
): Promise<{ ok: true; boxId: number; movedFrom: number | null }> {
  const { data: before } = await supabase
    .from('collection_entries').select('box_id').eq('id', entryId).single();
  const { error } = await supabase
    .from('collection_entries').update({ box_id: boxId }).eq('id', entryId);
  if (error) fail('Could not move that card', error);
  await rememberLastUsedBox(boxId);
  return { ok: true, boxId, movedFrom: before?.box_id ?? null };
}

/**
 * Records which printing a copy is. Null clears it back to unrecorded.
 *
 * Unlike the server, this does not merge a copy into an identical one. Each copy is its
 * own row by design, and two rows naming the same printing is a true statement about
 * owning two of them.
 */
export async function setCollectionEntryVariant(
  entryId: number,
  variantPosition: number | null,
): Promise<{ ok: boolean; variantPosition: number | null; mergedInto?: number }> {
  const { error } = await supabase
    .from('collection_entries')
    .update({ variant_position: variantPosition })
    .eq('id', entryId);
  if (error) fail('Could not set that printing', error);
  return { ok: true, variantPosition };
}

export async function removeCollectionEntry(entryId: number): Promise<{ ok: boolean }> {
  const { error } = await supabase.from('collection_entries').delete().eq('id', entryId);
  if (error) fail('Could not remove that copy', error);
  return { ok: true };
}
