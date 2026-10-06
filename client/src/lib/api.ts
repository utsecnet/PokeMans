import type {
  ApiQuota,
  StorageReport,
  CardFilters,
  CardListItem,
  CardPriceHistory,
  CardPricing,
  CardListResponse,
  Expansion,
  LinkedAccount,
  MetaRanges,
  PokemonDetail,
  PokemonFilters,
  PokemonListResponse,
  StatKey,
  SourceState,
  SyncStatus,
} from '../types';
import { supabase } from './supabase';
import { withLabels } from './printingLabel';
import {
  localiseCard,
  localiseCards,
  localSetSymbol,
  localSprite,
  localArtwork,
} from './localImages';

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

/**
 * The nine numeric filters as one object, which is how search_pokemon takes them.
 *
 * The server spelled these as eighteen query parameters (minHp, maxHp, minHeight …).
 * Collapsing them here keeps the function signature readable and means adding a tenth
 * filter later is a key, not two more parameters.
 */
function rangePayload(filters: Partial<PokemonFilters> | undefined) {
  if (!filters) return null;
  const out: Record<string, { min: number; max: number }> = {};
  for (const key of Object.keys(filters.stats ?? {}) as StatKey[]) {
    const r = filters.stats?.[key];
    if (r) out[key] = { min: r.min, max: r.max };
  }
  if (filters.height) out.height = filters.height;
  if (filters.weight) out.weight = filters.weight;
  if (filters.baseExperience) out.baseExperience = filters.baseExperience;
  return Object.keys(out).length > 0 ? out : null;
}

export async function fetchPokemonList({
  page,
  pageSize,
  filters,
  signal,
}: PokemonListParams = {}): Promise<PokemonListResponse> {
  const res = await rpc<PokemonListResponse>(
    'search_pokemon',
    {
      p_search: filters?.search || null,
      p_types: filters?.types?.length ? filters.types : null,
      p_type_mode: filters?.typeMode === 'all' ? 'all' : 'any',
      p_generations: filters?.generations?.length ? filters.generations : null,
      p_abilities: filters?.abilities?.length ? filters.abilities : null,
      p_expansions: filters?.expansions?.length ? filters.expansions : null,
      p_ranges: rangePayload(filters),
      p_sort: filters?.sortChain?.length
        ? filters.sortChain.map((r) => `${r.field}:${r.dir}`).join(',')
        : null,
      p_page: page ?? 1,
      p_page_size: pageSize ?? 60,
    },
    signal,
  );
  // Sprites and artwork are named by dex id, which for a default variety is the same as
  // the species id — and the list only ever returns default varieties.
  for (const row of res.items as unknown as Record<string, unknown>[]) {
    row.spriteUrl = localSprite(row.id as number);
    row.artworkUrl = localArtwork(row.id as number);
  }
  return res;
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
export async function fetchCardPriceHistory(
  cardId: string,
  signal?: AbortSignal,
): Promise<CardPriceHistory> {
  const [history, printings, display] = await Promise.all([
    rpc<CardPriceHistory>('card_price_history', { p_card_id: cardId }, signal),
    fetchCardPrintings(cardId, signal),
    fetchDisplayCurrency(),
  ]);

  // Charts arrive in marketplace order, which put Cardmarket's euros in front of
  // TCGplayer's dollars purely because "c" sorts before "t" — so the panel opened on a
  // currency nobody chose. Lead with the one the reader actually asked for; the rest keep
  // their order behind it, and nothing is hidden.
  history.charts.sort((a, b) => {
    const preferred = (c: { currency: string }) => (c.currency === display.currency ? 0 : 1);
    return preferred(a) - preferred(b) || a.service.localeCompare(b.service);
  });

  // Postgres returns each series by printing position; the readable name is built here,
  // from the same rule the collection view uses. A position with no matching printing
  // falls back to its number rather than an empty legend entry.
  const byPosition = new Map(printings.map((p) => [p.position, p.label]));
  for (const chart of history.charts) {
    for (const series of chart.series as unknown as Record<string, unknown>[]) {
      const label = byPosition.get(series.variantPosition as number)
        ?? `Printing ${series.variantPosition as number}`;
      series.printingLabel = label;
      // The marketplace is already the chart's identity, so the legend only has to tell
      // one printing from another within it.
      series.label = label;
    }
  }
  return history;
}

/** A card's printings, with readable names. Shared by the price chart and the card view. */
async function fetchCardPrintings(cardId: string, signal?: AbortSignal) {
  let q = supabase
    .from('tcg_card_variants')
    .select('position,type,subtype,stamp,size,foil')
    .eq('card_id', cardId)
    .order('position');
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return withLabels(data ?? []);
}

/** The currency every price is shown in, and the ones that can be chosen. */
/**
 * The currencies prices can be shown in, and the one dollars-first default.
 *
 * USD leads because the marketplaces price in it: TCGplayer quotes dollars, and it is the
 * larger of the two sources. Someone who wants euros says so once, in settings.
 */
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'] as const;

export async function fetchDisplayCurrency(): Promise<{ currency: string; supported: string[] }> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('value')
    .eq('key', 'display.currency')
    .maybeSingle();
  if (error) throw new Error(error.message);
  const stored = data?.value?.toUpperCase();
  return {
    // An unrecognised stored value falls back rather than propagating: a currency nothing
    // can be converted to would leave every price blank with no way to put it right.
    currency: stored && (SUPPORTED_CURRENCIES as readonly string[]).includes(stored) ? stored : 'USD',
    supported: [...SUPPORTED_CURRENCIES],
  };
}

export async function setDisplayCurrency(
  currency: string,
): Promise<{ currency: string; supported: string[] }> {
  const wanted = currency.toUpperCase();
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(wanted)) {
    throw new Error(`Unsupported currency. Choose one of: ${SUPPORTED_CURRENCIES.join(', ')}`);
  }
  const { error } = await supabase
    .from('user_settings')
    .upsert({ key: 'display.currency', value: wanted, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,key' });
  if (error) throw new Error(error.message);
  return { currency: wanted, supported: [...SUPPORTED_CURRENCIES] };
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
/**
 * Captures today's price for one card, so a card nobody owns still shows something.
 *
 * Skipped server-side when today's figures are already held, so re-opening a card costs a
 * database read rather than an upstream request — and because prices are shared, the
 * second person to open it costs nothing at all.
 */
export async function captureCardPrices(
  cardId: string,
  signal?: AbortSignal,
): Promise<{ captured: number }> {
  const { data, error } = await supabase.functions.invoke('sync-prices', {
    body: { cardIds: [cardId] },
    ...(signal ? { signal } : {}),
  });
  // A capture that fails leaves whatever was already stored on screen, so this reports
  // nothing rather than throwing: the panel has history to show either way.
  if (error) return { captured: 0 };
  return { captured: (data as { changed?: number })?.changed ?? 0 };
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

// Collections moved to collectionApi.ts when they moved to Supabase: the Express versions
// were a dozen fetch calls, the Supabase ones carry real logic (copy ordering on removal,
// label building, local image paths) and had outgrown sitting inline here. Re-exported so
// every call site keeps importing from one place.
export {
  fetchCollectionBoxes,
  fetchCollectionBox,
  createCollectionBox,
  renameCollectionBox,
  setCollectionBoxColor,
  setCollectionBoxIcon,
  reorderCollectionBoxes,
  deleteCollectionBox,
  addToCollection,
  moveCollectionEntry,
  setCollectionEntryVariant,
  removeCollectionEntry,
} from './collectionApi';

/* ---------------------------------------------------------------- want lists */

// Want lists moved to wantsApi.ts when they moved to Supabase, for the same reason
// collections did: the Supabase versions carry logic (live refresh, exclusion on removal,
// local image paths) that had outgrown sitting inline. Re-exported so call sites are
// unaffected.
export {
  fetchWantLists,
  fetchWantList,
  fetchWantsByCard,
  createWantList,
  updateWantList,
  deleteWantList,
  refreshWantList,
  addToWantList,
  removeFromWantList,
} from './wantsApi';

export function refreshAccountQuota(service: string): Promise<{ quota: ApiQuota | null }> {
  return fetch(`/api/settings/linked-accounts/${service}/quota`, { method: 'POST' }).then(
    json<{ quota: ApiQuota | null }>,
  );
}

/** How much of each kind of data the databases hold. Measured on request, not cached. */
export function fetchStorage(): Promise<StorageReport> {
  return fetch('/api/settings/storage').then(json<StorageReport>);
}
