import type {
  ApiQuota,
  StorageReport,
  CardFilters,
  CardListItem,
  CardPriceHistory,
  CardPricing,
  CardListResponse,
  CollectionBoxDetail,
  CollectionBoxesResponse,
  ContainerType,
  Expansion,
  LinkedAccount,
  MetaRanges,
  PokemonDetail,
  PokemonFilters,
  PokemonListResponse,
  StatKey,
  SourceState,
  SyncStatus,
  WantList,
  WantListDetail,
  WantsByCard,
} from '../types';
import { cap } from './format';
import { supabase } from './supabase';
import { localiseCard, localiseCards, localSetSymbol } from './localImages';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // response wasn't JSON
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/**
 * Calls a Postgres function and returns its result, or throws.
 *
 * Every read in this file used to be a fetch of an Express route; the catalogue ones are
 * now database functions reached through PostgREST. The shapes they return are unchanged,
 * so nothing that calls into this module had to change.
 *
 * A caller passing an AbortSignal expects the old fetch behaviour, where aborting a
 * superseded request stops it. supabase-js takes a signal through .abortSignal(), and an
 * aborted call rejects — which is what the callers already handle, since that is what
 * fetch did.
 */
async function rpc<T>(
  fn: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  let q = supabase.rpc(fn, args);
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) {
    // 42501 is "permission denied", which here almost always means the session expired
    // or never started rather than anything the user did wrong.
    if (error.code === '42501') {
      throw new Error('Not signed in. Reload the page to start a session.');
    }
    throw new Error(error.message);
  }
  return data as T;
}

export interface PokemonListParams {
  page?: number;
  pageSize?: number;
  filters?: Partial<PokemonFilters>;
  /** Aborts the request when a newer one supersedes it (e.g. paging past this page). */
  signal?: AbortSignal;
}

export function fetchPokemonList({
  page,
  pageSize,
  filters,
  signal,
}: PokemonListParams = {}): Promise<PokemonListResponse> {
  const query = new URLSearchParams();
  if (page) query.set('page', String(page));
  if (pageSize) query.set('pageSize', String(pageSize));

  if (filters) {
    if (filters.search) query.set('search', filters.search);
    if (filters.types?.length) query.set('types', filters.types.join(','));
    if (filters.typeMode) query.set('typeMode', filters.typeMode);
    if (filters.generations?.length) query.set('generations', filters.generations.join(','));
    if (filters.abilities?.length) query.set('abilities', filters.abilities.join(','));
    if (filters.expansions?.length) query.set('expansions', filters.expansions.join(','));
    if (filters.sortChain?.length) {
      query.set('sort', filters.sortChain.map((r) => `${r.field}:${r.dir}`).join(','));
    }

    if (filters.stats) {
      for (const key of Object.keys(filters.stats) as StatKey[]) {
        const range = filters.stats[key];
        if (!range) continue;
        query.set(`min${cap(key)}`, String(range.min));
        query.set(`max${cap(key)}`, String(range.max));
      }
    }
    if (filters.height) {
      query.set('minHeight', String(filters.height.min));
      query.set('maxHeight', String(filters.height.max));
    }
    if (filters.weight) {
      query.set('minWeight', String(filters.weight.min));
      query.set('maxWeight', String(filters.weight.max));
    }
    if (filters.baseExperience) {
      query.set('minBaseExperience', String(filters.baseExperience.min));
      query.set('maxBaseExperience', String(filters.baseExperience.max));
    }
  }

  return fetch(`/api/pokemon?${query.toString()}`, { signal }).then(json<PokemonListResponse>);
}

export function fetchPokemonDetail(id: number | string): Promise<PokemonDetail> {
  return fetch(`/api/pokemon/${id}`).then(json<PokemonDetail>);
}

export function fetchTypes(): Promise<string[]> {
  return rpc<string[]>('meta_pokemon_types');
}

export function fetchGenerations(): Promise<string[]> {
  return rpc<string[]>('meta_generations');
}

export function fetchAbilities(): Promise<string[]> {
  return rpc<string[]>('meta_abilities');
}

export function fetchRanges(): Promise<MetaRanges> {
  return rpc<MetaRanges>('meta_ranges');
}

export async function fetchExpansions(): Promise<Expansion[]> {
  const rows = await rpc<Expansion[]>('meta_expansions');
  for (const row of rows) row.symbolUrl = localSetSymbol(row.id);
  return rows;
}

export interface CardListParams {
  page?: number;
  pageSize?: number;
  filters?: Partial<CardFilters>;
  /** Aborts the request when a newer one supersedes it (e.g. paging past this page). */
  signal?: AbortSignal;
}

/**
 * A card filter as query-string parameters.
 *
 * Split out of fetchCards because a want list built from a filter stores this string and
 * re-runs it later, possibly months later. Serialising it twice would mean two definitions
 * of what a filter is, and a live list would drift from what the browser shows the first
 * time either gained a field. Sort is left out deliberately: a want list is a set, and the
 * order cards were listed in when it was created has no bearing on membership.
 */
export function cardFilterParams(filters: Partial<CardFilters> | undefined): URLSearchParams {
  const query = new URLSearchParams();
  if (!filters) return query;
  if (filters.search) query.set('search', filters.search);
  if (filters.expansions?.length) query.set('expansions', filters.expansions.join(','));
  if (filters.series?.length) query.set('series', filters.series.join(','));
  if (filters.rarities?.length) query.set('rarities', filters.rarities.join(','));
  if (filters.types?.length) query.set('types', filters.types.join(','));
  if (filters.generations?.length) query.set('generations', filters.generations.join(','));
  if (filters.supertypes?.length) query.set('supertypes', filters.supertypes.join(','));
  if (filters.illustrators?.length) query.set('illustrators', filters.illustrators.join(','));
  if (filters.owned !== null && filters.owned !== undefined) {
    query.set('owned', String(filters.owned));
  }
  return query;
}

export async function fetchCards({
  page,
  pageSize,
  filters,
  signal,
}: CardListParams = {}): Promise<CardListResponse> {
  const res = await rpc<CardListResponse>(
    'search_cards',
    {
      p_search: filters?.search || null,
      p_expansions: filters?.expansions?.length ? filters.expansions : null,
      p_series: filters?.series?.length ? filters.series : null,
      p_rarities: filters?.rarities?.length ? filters.rarities : null,
      p_types: filters?.types?.length ? filters.types : null,
      p_generations: filters?.generations?.length ? filters.generations : null,
      p_supertypes: filters?.supertypes?.length ? filters.supertypes : null,
      p_illustrators: filters?.illustrators?.length ? filters.illustrators : null,
      p_owned: filters?.owned ?? null,
      p_sort: filters?.sortChain?.length
        ? filters.sortChain.map((r) => `${r.field}:${r.dir}`).join(',')
        : null,
      p_page: page ?? 1,
      p_page_size: pageSize ?? 60,
    },
    signal,
  );
  localiseCards(res.items as unknown as Record<string, unknown>[]);
  return res;
}

export function fetchRarities(): Promise<string[]> {
  return rpc<string[]>('meta_rarities');
}

/** The energy types printed on cards — a different vocabulary from fetchTypes()'s Pokémon types. */
export function fetchCardSupertypes(): Promise<string[]> {
  return rpc<string[]>('meta_supertypes');
}

export function fetchCardIllustrators(): Promise<string[]> {
  return rpc<string[]>('meta_illustrators');
}

export function fetchCardTypes(): Promise<string[]> {
  return rpc<string[]>('meta_card_types');
}

/** One card in the same shape the list returns — lets the card view open from just an id. */
export async function fetchCard(cardId: string, signal?: AbortSignal): Promise<CardListItem> {
  // Reuses the list query rather than defining a second card row shape that would have to
  // be kept in step with it. Narrowed to the card's own set first, so this reads one set
  // rather than the catalogue.
  //
  // That relies on a card id being exactly <set_id>-<rest>, which holds for all 20,635
  // cards, and on no set id containing a dash, which holds for all 176 sets. Both were
  // checked rather than assumed; if a future set breaks either, this falls back to a
  // not-found error rather than a wrong card.
  const res = await rpc<CardListResponse>(
    'search_cards',
    { p_search: null, p_page: 1, p_page_size: 25000, p_expansions: [cardId.split('-')[0]] },
    signal,
  );
  const found = res.items.find((c) => c.id === cardId);
  if (!found) throw new Error(`Card not found: ${cardId}`);
  localiseCard(found as unknown as Record<string, unknown>);
  return found;
}

/** Recorded price history, grouped into one chart per service and marketplace. */
export function fetchCardPriceHistory(cardId: string, signal?: AbortSignal): Promise<CardPriceHistory> {
  return fetch(`/api/cards/${encodeURIComponent(cardId)}/price-history`, { signal })
    .then(json<CardPriceHistory>);
}

/** The currency every price is shown in, and the ones that can be chosen. */
export function fetchDisplayCurrency(): Promise<{ currency: string; supported: string[] }> {
  return fetch('/api/settings/currency').then(json<{ currency: string; supported: string[] }>);
}

export function setDisplayCurrency(currency: string): Promise<{ currency: string; supported: string[] }> {
  return fetch('/api/settings/currency', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currency }),
  }).then(json<{ currency: string; supported: string[] }>);
}

/** External services the user can link. Never returns a stored key, only a masked hint. */
export function fetchLinkedAccounts(): Promise<{ providers: LinkedAccount[] }> {
  return fetch('/api/settings/linked-accounts').then(json<{ providers: LinkedAccount[] }>);
}

/** Saves a key after the service confirms it works; rejects it otherwise. */
export function saveLinkedAccount(
  service: string,
  key: string,
): Promise<{ ok: boolean; message: string | null; providers: LinkedAccount[] }> {
  return fetch(`/api/settings/linked-accounts/${encodeURIComponent(service)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  }).then(json<{ ok: boolean; message: string | null; providers: LinkedAccount[] }>);
}

export function removeLinkedAccount(service: string): Promise<{ providers: LinkedAccount[] }> {
  return fetch(`/api/settings/linked-accounts/${encodeURIComponent(service)}`, {
    method: 'DELETE',
  }).then(json<{ providers: LinkedAccount[] }>);
}

/** Live market prices per print variant. Fetched on demand, so it's never stale. */
/** Asks the server to fetch today's prices for this card if it doesn't already hold them. */
export function captureCardPrices(
  cardId: string,
  signal?: AbortSignal,
): Promise<{ captured: boolean; rows: number; reason: string | null }> {
  return fetch(`/api/cards/${encodeURIComponent(cardId)}/prices/capture`, {
    method: 'POST',
    signal,
  }).then(json<{ captured: boolean; rows: number; reason: string | null }>);
}

export function fetchCardPricing(cardId: string, signal?: AbortSignal): Promise<CardPricing> {
  return fetch(`/api/cards/${encodeURIComponent(cardId)}/pricing`, { signal }).then(json<CardPricing>);
}

export function fetchSeries(): Promise<string[]> {
  return rpc<string[]>('meta_series');
}

export function fetchSyncSources(): Promise<{ sources: SourceState[] }> {
  return fetch('/api/sync/sources').then(json<{ sources: SourceState[] }>);
}

export function fetchSyncStatus(): Promise<SyncStatus> {
  return fetch('/api/sync/status').then(json<SyncStatus>);
}

export function triggerPokeApiSync(): Promise<{ started: boolean }> {
  return fetch('/api/sync/pokeapi', { method: 'POST' }).then(json<{ started: boolean }>);
}

export function triggerTcgSync(): Promise<{ started: boolean }> {
  return fetch('/api/sync/tcg', { method: 'POST' }).then(json<{ started: boolean }>);
}

/**
 * Fetches set symbols and logos onto the device. Safe to repeat — anything already stored is
 * skipped, so a second run only picks up sets added since the last one.
 */
export function triggerLogoSync(): Promise<{ started: boolean }> {
  return fetch('/api/sync/logos', { method: 'POST' }).then(json<{ started: boolean }>);
}

/**
 * Asks the server to fetch, convert and keep this card's full-size art.
 *
 * Resolves to { url: null } when no source could be reached rather than rejecting: the card
 * view has already painted the shipped 245px copy, so a failure here is a view that stays as
 * it is, not an error anyone needs to see.
 */
export function warmCardHires(cardId: string): Promise<{ url: string | null }> {
  return fetch(`/api/cards/${encodeURIComponent(cardId)}/hires`, { method: 'POST' }).then(
    json<{ url: string | null }>,
  );
}

/** Refreshes prices for owned cards now, rather than waiting for the daily schedule. */
export function triggerPriceSync(): Promise<{ started: boolean }> {
  return fetch('/api/sync/prices', { method: 'POST' }).then(json<{ started: boolean }>);
}

export function fetchCollectionBoxes(): Promise<CollectionBoxesResponse> {
  return fetch('/api/collection/boxes').then(json<CollectionBoxesResponse>);
}

export function fetchCollectionBox(boxId: number): Promise<CollectionBoxDetail> {
  return fetch(`/api/collection/boxes/${boxId}`).then(json<CollectionBoxDetail>);
}

export function createCollectionBox(
  name: string,
  type: ContainerType = 'box',
  color: string | null = null,
): Promise<CollectionBoxesResponse['boxes'][number]> {
  return fetch('/api/collection/boxes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type, color }),
  }).then(json<CollectionBoxesResponse['boxes'][number]>);
}

export function renameCollectionBox(boxId: number, name: string): Promise<{ ok: boolean }> {
  return fetch(`/api/collection/boxes/${boxId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(json<{ ok: boolean }>);
}

export function setCollectionBoxColor(
  boxId: number,
  color: string | null,
): Promise<{ ok: boolean }> {
  return fetch(`/api/collection/boxes/${boxId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ color }),
  }).then(json<{ ok: boolean }>);
}

export function setCollectionBoxIcon(boxId: number, icon: string | null): Promise<{ ok: boolean }> {
  return fetch(`/api/collection/boxes/${boxId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ icon }),
  }).then(json<{ ok: boolean }>);
}

/** Sets the manual order from the arrangement the page is currently showing. */
export function reorderCollectionBoxes(ids: number[]): Promise<{ ok: boolean }> {
  return fetch('/api/collection/boxes/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  }).then(json<{ ok: boolean }>);
}

export function deleteCollectionBox(boxId: number): Promise<{ ok: boolean }> {
  return fetch(`/api/collection/boxes/${boxId}`, { method: 'DELETE' }).then(json<{ ok: boolean }>);
}

export function addToCollection(
  boxId: number,
  cardId: string,
  delta = 1,
): Promise<{ id: number; quantity: number; boxId: number; cardId: string }> {
  return fetch('/api/collection/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boxId, cardId, delta }),
  }).then(json<{ id: number; quantity: number; boxId: number; cardId: string }>);
}


/**
 * Records which printing a copy is. Passing null clears it back to unrecorded. If the box
 * already holds that card in that printing the two rows are merged, and the response says
 * which entry absorbed this one.
 */
/** Moves one copy to another collection, keeping its printing and filing date. */
export function moveCollectionEntry(
  entryId: number,
  boxId: number,
): Promise<{ ok: true; boxId: number; movedFrom: number | null }> {
  return fetch(`/api/collection/entries/${entryId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boxId }),
  }).then(json<{ ok: true; boxId: number; movedFrom: number | null }>);
}

export function setCollectionEntryVariant(
  entryId: number,
  variantPosition: number | null,
): Promise<{ ok: boolean; variantPosition: number | null; mergedInto?: number }> {
  return fetch(`/api/collection/entries/${entryId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantPosition }),
  }).then(json<{ ok: boolean; variantPosition: number | null; mergedInto?: number }>);
}

export function removeCollectionEntry(entryId: number): Promise<{ ok: boolean }> {
  return fetch(`/api/collection/entries/${entryId}`, { method: 'DELETE' }).then(
    json<{ ok: boolean }>,
  );
}

/* ---------------------------------------------------------------- want lists */

export function fetchWantLists(): Promise<{ lists: WantList[] }> {
  return fetch('/api/wants').then(json<{ lists: WantList[] }>);
}

export function fetchWantList(listId: number): Promise<WantListDetail> {
  return fetch(`/api/wants/${listId}`).then(json<WantListDetail>);
}

/**
 * Creates a want list. Passing `query` seeds it with everything that filter currently
 * matches; `live` additionally re-runs that filter later, so cards printed after today can
 * join the list on their own.
 */
export function createWantList(
  name: string,
  color: string | null = null,
  query: string | null = null,
  live = false,
): Promise<WantList & { seeded: number }> {
  return fetch('/api/wants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color, query, live }),
  }).then(json<WantList & { seeded: number }>);
}

export function updateWantList(
  listId: number,
  patch: { name?: string; color?: string | null; live?: boolean },
): Promise<WantList & { added: number }> {
  return fetch(`/api/wants/${listId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then(json<WantList & { added: number }>);
}

export function deleteWantList(listId: number): Promise<void> {
  return fetch(`/api/wants/${listId}`, { method: 'DELETE' }).then(() => undefined);
}

/** Re-runs a live list's filter now rather than waiting until it is next opened. */
export function refreshWantList(listId: number): Promise<WantList & { added: number }> {
  return fetch(`/api/wants/${listId}/refresh`, { method: 'POST' }).then(
    json<WantList & { added: number }>,
  );
}

export function addToWantList(listId: number, cardId: string): Promise<{ cardId: string }> {
  return fetch(`/api/wants/${listId}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId }),
  }).then(json<{ cardId: string }>);
}

export function removeFromWantList(listId: number, cardId: string): Promise<void> {
  return fetch(`/api/wants/${listId}/cards/${encodeURIComponent(cardId)}`, {
    method: 'DELETE',
  }).then(() => undefined);
}

export function fetchWantsByCard(): Promise<{ byCard: WantsByCard }> {
  return fetch('/api/wants/meta/by-card').then(json<{ byCard: WantsByCard }>);
}

/**
 * Re-reads a provider's remaining allowance. Costs one call against that allowance, which
 * is why it is a deliberate action rather than something the Settings page does on load.
 */
export function refreshAccountQuota(service: string): Promise<{ quota: ApiQuota | null }> {
  return fetch(`/api/settings/linked-accounts/${service}/quota`, { method: 'POST' }).then(
    json<{ quota: ApiQuota | null }>,
  );
}

/** How much of each kind of data the databases hold. Measured on request, not cached. */
export function fetchStorage(): Promise<StorageReport> {
  return fetch('/api/settings/storage').then(json<StorageReport>);
}
