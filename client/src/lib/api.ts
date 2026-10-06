import type {
  CardFilters,
  CardListItem,
  CardPriceHistory,
  CardPricing,
  CardListResponse,
  Expansion,
  MetaRanges,
  PokemonDetail,
  PokemonFilters,
  PokemonListResponse,
  StatKey,
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

/**
 * Recorded price history, one chart per marketplace.
 *
 * Postgres returns a sparse table made dense: price_point holds a row only where the value
 * moved, and card_price_history carries the last known value forward across the gaps, so
 * what arrives here is already a continuous daily series. Nothing in this file has to know
 * the storage is sparse.
 */
export async function fetchCardPriceHistory(
  cardId: string,
  days = 365,
  signal?: AbortSignal,
): Promise<CardPriceHistory> {
  const [raw, printings] = await Promise.all([
    rpc<RawPriceChart[]>('card_price_history', { p_card_id: cardId, p_days: days }, signal),
    fetchCardPrintings(cardId, signal),
  ]);

  // The readable printing name is built here, from the same rule the collection view uses,
  // so a legend never shows a bare position number.
  const byPosition = new Map(printings.map((p) => [p.position, p.label]));

  return {
    cardId,
    charts: (raw ?? []).map((chart) => ({
      service: chart.sourceKey,
      label: chart.label,
      currency: chart.currency,
      series: chart.printings.map((printing) => {
        const label = byPosition.get(printing.variantPosition) ?? `Printing ${printing.variantPosition}`;
        return {
          label,
          printingLabel: label,
          marketplace: chart.label,
          variantPosition: printing.variantPosition,
          // TCGplayer prices by printing, not by condition, so there is one series per
          // printing and nothing to fold together.
          condition: null,
          points: printing.points.map((pt) => ({
            date: pt.day,
            market: pt.market ?? 0,
            low: pt.low,
          })),
        };
      }),
    })),
  };
}

/** The shape card_price_history returns, before printing names are attached. */
interface RawPriceChart {
  sourceKey: string;
  label: string;
  currency: string;
  printings: { variantPosition: number; label: string; points: { day: string; market: number | null; low: number | null }[] }[];
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

/**
 * Prices are shown in the currency of the marketplace that quoted them.
 *
 * There was a display-currency setting offering six currencies. It is gone, and so is the
 * fx_rates table behind it, which held zero rows for its whole life -- so the control had
 * never once converted anything; it only decided which chart was shown first. With a single
 * USD source there is no second chart to choose between, and a selector that silently does
 * nothing is worse than no selector.
 *
 * Restoring it means a rate feed, not a setting: a daily job writing real rates, and a
 * conversion applied at read time with the source currency still labelled on the axis.
 */
export const PRICE_CURRENCY_NOTE =
  'Prices are shown as quoted by the marketplace.';





/** Live market prices per print variant. Fetched on demand, so it's never stale. */
/** Asks the server to fetch today's prices for this card if it doesn't already hold them. */

export function fetchCardPricing(cardId: string, signal?: AbortSignal): Promise<CardPricing> {
  return fetch(`/api/cards/${encodeURIComponent(cardId)}/pricing`, { signal }).then(json<CardPricing>);
}

export function fetchSeries(): Promise<string[]> {
  return rpc<string[]>('meta_series');
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


