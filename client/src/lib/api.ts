import type {
  CardFilters,
  CardListItem,
  CardPriceHistory,
  CardListResponse,
  Expansion,
  MetaRanges,
  PokemonDetail,
  EvolutionNode,
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

/**
 * Everything the detail page shows for one Pokémon.
 *
 * Postgres returns no image paths. It returns ids, and every sprite, artwork and card image
 * is named from one here -- the same rule the list follows, and the reason there is one
 * place in the app that knows where image files live. A URL baked into a query would be a
 * second place, and the one that gets forgotten when the files move.
 *
 * The walk is recursive because the shape is: an evolution node has children, and each of
 * the other forms carries a chain of its own.
 */
export async function fetchPokemonDetail(
  id: number | string,
  signal?: AbortSignal,
): Promise<PokemonDetail> {
  const detail = await rpc<PokemonDetail | null>('pokemon_detail', { p_id: Number(id) }, signal);
  if (!detail) throw new Error('Pokémon not found');

  const dressNode = (node: EvolutionNode | null): EvolutionNode | null => {
    if (!node) return null;
    node.spriteUrl = localSprite(node.id);
    node.artworkUrl = localArtwork(node.id);
    node.children = (node.children ?? []).map(dressNode).filter((n): n is EvolutionNode => n !== null);
    return node;
  };

  detail.spriteUrl = localSprite(detail.id);
  detail.artworkUrl = localArtwork(detail.id);
  detail.evolutionChain = dressNode(detail.evolutionChain);
  for (const v of detail.variants ?? []) {
    v.spriteUrl = localSprite(v.id);
    v.artworkUrl = localArtwork(v.id);
    v.evolutionChain = dressNode(v.evolutionChain);
  }
  localiseCards(detail.tcgCards as unknown as Record<string, unknown>[]);
  return detail;
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
      basis: chart.basis ?? null,
      series: chart.printings.map((printing) => {
        // One price can cover several printings, because TCGdex splits print runs that
        // TCGplayer sells as a single product. Naming all of them keeps the chart honest
        // about what is being priced and still lets someone find the printing they own.
        const positions = printing.variantPositions?.length
          ? printing.variantPositions
          : [printing.variantPosition];
        const label = mergedPrintingLabel(
          positions.map((pos) => byPosition.get(pos) ?? `Printing ${pos}`));
        return {
          label,
          printingLabel: label,
          marketplace: chart.label,
          variantPosition: printing.variantPosition,
          // TCGplayer prices by printing, not by condition, so there is one series per
          // printing and nothing to fold together.
          condition: null,
          // No `?? 0` here. A missing market price is not a price of nothing, and
          // coercing it put a line along the bottom of the chart for any printing the
          // marketplace had no sales for. Postgres now excludes those printings entirely,
          // so anything arriving here has a real figure.
          points: printing.points.map((pt) => ({
            date: pt.day,
            market: pt.market as number,
            low: pt.low,
          })),
        };
      }),
    })),
  };
}

/**
 * The first day any price was recorded for a card, whatever window is being shown.
 *
 * A windowed read cannot see past its own window, and the caption under the chart says how
 * far the record goes back -- so this asks the table rather than inferring it from points
 * that may have been filtered out.
 */
export async function fetchCardFirstPriced(cardId: string, signal?: AbortSignal): Promise<string | null> {
  return rpc<string | null>('card_first_priced', { p_card_id: cardId }, signal);
}

/**
 * One label for several printings that share a price.
 *
 * Joining them whole repeated whatever they have in common: three printings of one card
 * became "Normal · Unlimited / Normal · 1999-2000 Copyright / Normal · Pikachu", where the
 * only words that distinguish them are the last of each. The shared opening is said once
 * and the differences follow it.
 */
function mergedPrintingLabel(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  const parts = labels.map((l) => l.split(' · '));
  let shared = 0;
  while (
    shared < parts[0].length - 1 &&
    parts.every((p) => p.length > shared + 1 && p[shared] === parts[0][shared])
  ) shared++;
  const prefix = parts[0].slice(0, shared).join(' · ');
  const tails = parts.map((p) => p.slice(shared).join(' · '));
  return prefix ? `${prefix} · ${tails.join(' / ')}` : tails.join(' / ');
}

/** The shape card_price_history returns, before printing names are attached. */
interface RawPriceChart {
  sourceKey: string;
  label: string;
  currency: string;
  /** Which condition the figures are for, e.g. "Near Mint". */
  basis: string | null;
  printings: {
    variantPosition: number;
    /** Every printing this one price covers; usually one, sometimes several. */
    variantPositions: number[];
    points: { day: string; market: number | null; low: number | null }[];
  }[];
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
/**
 * The TCGplayer product id for a card, for the one case that needs it.
 *
 * Asked for only when both local art and images.pokemontcg.io have failed, which is a
 * handful of the newest sets -- so it is a query on a rare path rather than another column
 * on every card read. price_map already holds one per printing; any of them will do,
 * because every printing of a card shares its artwork.
 */
export async function fetchTcgplayerProductId(cardId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('price_map')
    .select('external_id,tcg_cards!inner(id)')
    .eq('tcg_cards.id', cardId)
    .limit(1);
  if (error || !data?.length) return null;
  return (data[0] as { external_id: number }).external_id ?? null;
}

export function fetchSeries(): Promise<string[]> {
  return rpc<string[]>('meta_series');
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


