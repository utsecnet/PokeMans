import type {
  PokemonDetail,
  PokemonListResponse,
  SettingsResponse,
  SyncStatus,
} from '../types';

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
  search?: string;
  type?: string;
  generation?: string;
}

export function fetchPokemonList(params: PokemonListParams = {}): Promise<PokemonListResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.search) query.set('search', params.search);
  if (params.type) query.set('type', params.type);
  if (params.generation) query.set('generation', params.generation);

  return fetch(`/api/pokemon?${query.toString()}`).then(json<PokemonListResponse>);
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

export function fetchSyncStatus(): Promise<SyncStatus> {
  return fetch('/api/sync/status').then(json<SyncStatus>);
}

export function triggerPokeApiSync(): Promise<{ started: boolean }> {
  return fetch('/api/sync/pokeapi', { method: 'POST' }).then(json<{ started: boolean }>);
}

export function triggerTcgSync(): Promise<{ started: boolean }> {
  return fetch('/api/sync/tcg', { method: 'POST' }).then(json<{ started: boolean }>);
}

export function fetchSettings(): Promise<SettingsResponse> {
  return fetch('/api/settings').then(json<SettingsResponse>);
}

export function saveTcgApiKey(apiKey: string): Promise<{ ok: boolean }> {
  return fetch('/api/settings/tcg-api-key', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  }).then(json<{ ok: boolean }>);
}

export function removeTcgApiKey(): Promise<{ ok: boolean }> {
  return fetch('/api/settings/tcg-api-key', { method: 'DELETE' }).then(json<{ ok: boolean }>);
}
