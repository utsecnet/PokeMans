import type {
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
  SyncStatus,
} from '../types';
import { cap } from './format';

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
  return fetch('/api/pokemon/meta/types').then(json<string[]>);
}

export function fetchGenerations(): Promise<string[]> {
  return fetch('/api/pokemon/meta/generations').then(json<string[]>);
}

export function fetchAbilities(): Promise<string[]> {
  return fetch('/api/pokemon/meta/abilities').then(json<string[]>);
}

export function fetchRanges(): Promise<MetaRanges> {
  return fetch('/api/pokemon/meta/ranges').then(json<MetaRanges>);
}

export function fetchExpansions(): Promise<Expansion[]> {
  return fetch('/api/pokemon/meta/expansions').then(json<Expansion[]>);
}

export interface CardListParams {
  page?: number;
  pageSize?: number;
  filters?: Partial<CardFilters>;
  /** Aborts the request when a newer one supersedes it (e.g. paging past this page). */
  signal?: AbortSignal;
}

export function fetchCards({
  page,
  pageSize,
  filters,
  signal,
}: CardListParams = {}): Promise<CardListResponse> {
  const query = new URLSearchParams();
  if (page) query.set('page', String(page));
  if (pageSize) query.set('pageSize', String(pageSize));

  if (filters) {
    if (filters.search) query.set('search', filters.search);
    if (filters.expansions?.length) query.set('expansions', filters.expansions.join(','));
    if (filters.series?.length) query.set('series', filters.series.join(','));
    if (filters.rarities?.length) query.set('rarities', filters.rarities.join(','));
    if (filters.types?.length) query.set('types', filters.types.join(','));
    if (filters.generations?.length) query.set('generations', filters.generations.join(','));
    if (filters.owned !== null && filters.owned !== undefined) {
      query.set('owned', String(filters.owned));
    }
    if (filters.sortChain?.length) {
      query.set('sort', filters.sortChain.map((r) => `${r.field}:${r.dir}`).join(','));
    }
  }

  return fetch(`/api/cards?${query.toString()}`, { signal }).then(json<CardListResponse>);
}

export function fetchRarities(): Promise<string[]> {
  return fetch('/api/cards/meta/rarities').then(json<string[]>);
}

/** The energy types printed on cards — a different vocabulary from fetchTypes()'s Pokémon types. */
export function fetchCardTypes(): Promise<string[]> {
  return fetch('/api/cards/meta/types').then(json<string[]>);
}

/** One card in the same shape the list returns — lets the card view open from just an id. */
export function fetchCard(cardId: string, signal?: AbortSignal): Promise<CardListItem> {
  return fetch(`/api/cards/${encodeURIComponent(cardId)}`, { signal }).then(json<CardListItem>);
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
export function fetchCardPricing(cardId: string, signal?: AbortSignal): Promise<CardPricing> {
  return fetch(`/api/cards/${encodeURIComponent(cardId)}/pricing`, { signal }).then(json<CardPricing>);
}

export function fetchSeries(): Promise<string[]> {
  return fetch('/api/cards/meta/series').then(json<string[]>);
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

export function setCollectionEntryQuantity(
  entryId: number,
  quantity: number,
): Promise<{ ok: boolean }> {
  return fetch(`/api/collection/entries/${entryId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity }),
  }).then(json<{ ok: boolean }>);
}

/**
 * Records which printing a copy is. Passing null clears it back to unrecorded. If the box
 * already holds that card in that printing the two rows are merged, and the response says
 * which entry absorbed this one.
 */
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
