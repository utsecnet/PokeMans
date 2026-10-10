/**
 * The admin side: running the daily jobs, and seeing what they did.
 *
 * Everything here is gated twice, deliberately. The interface hides these controls from
 * anyone who is not an admin, and the Edge Function and the row policies refuse them anyway
 * — hiding a button is a courtesy to the reader, not a security measure, and neither the
 * function nor Postgres has any idea what the interface chose to draw.
 */
import { supabase } from './supabase';
import type {
  DatabaseUsage,
  PriceHealthReport,
  PriceProvenance,
  SetCoverageRow,
  SyncTrack,
} from '../types';

export interface PriceSyncResult {
  ok: true;
  capturedOn: string;
  status: 'ok' | 'warn' | 'error';
  setsFetched: number;
  failures: number;
  /** Sets still waiting. Non-zero means run it again. */
  remaining: number;
  incoming?: number;
  resolved?: number;
  unmapped?: number;
  changed?: number;
  unchanged?: number;
  durationMs?: number;
  skipped?: boolean;
  note?: string;
}

/** The function's own message, which invoke() buries inside a generic HTTP error. */
async function detailed(error: unknown): Promise<never> {
  const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
  throw new Error(body?.error ?? (error as Error).message);
}

/**
 * Captures today's prices for the whole catalogue.
 *
 * One call now covers every card: the source publishes a file per set, so 220 requests
 * replace the 20,635 single-card fetches the previous source needed. `remaining` is kept in
 * the response anyway — the function caps how many sets it will take in one invocation, so
 * a slow day degrades into "call again" rather than being killed with nothing written.
 */
export async function runPriceSync(options: { limit?: number; force?: boolean } = {}): Promise<PriceSyncResult> {
  const { data, error } = await supabase.functions.invoke('sync-prices', { body: options });
  if (error) return detailed(error);
  return data as PriceSyncResult;
}

/** Runs the capture until nothing is left, reporting after each batch. */
export async function runPriceSyncToCompletion(
  onProgress?: (result: PriceSyncResult) => void,
): Promise<PriceSyncResult> {
  let last = await runPriceSync();
  onProgress?.(last);
  // A cap on rounds, not `while (remaining)`. If something upstream starts failing for every
  // set, `remaining` never falls and an unbounded loop would hammer a free service run by
  // one person until the tab is closed.
  for (let round = 0; round < 5 && last.remaining > 0; round++) {
    last = await runPriceSync();
    onProgress?.(last);
  }
  return last;
}

/** Applies the retention bands. `dryRun` reports what it would remove without removing it. */
export async function runHistoryThinning(dryRun = false) {
  const { data, error } = await supabase.functions.invoke('thin-price-history', { body: { dryRun } });
  if (error) return detailed(error);
  return data as {
    ok: true; dryRun: boolean; before: number; after: number; removed: number;
    // Described by the function rather than reconstructed here: it owns the policy, and a
    // second copy of the band definitions in the client is a second thing to forget to
    // change. The previous shape -- fromAge, toAge, keepEvery -- survived a policy rewrite
    // and rendered "undefined-undefined days, keep every undefined".
    bands: { band: string; keep: string; removed: number }[];
  };
}

/** A year of daily outcomes per job, including the days nothing ran. */
export async function fetchSyncCalendar(days = 365): Promise<SyncTrack[]> {
  const { data, error } = await supabase.rpc('sync_calendar', { p_days: days });
  if (error) throw new Error(error.message);
  return (data ?? []) as SyncTrack[];
}

/** Whether the price data is sound, as distinct from whether the job ran. */
export async function fetchPriceHealth(): Promise<PriceHealthReport> {
  const { data, error } = await supabase.rpc('price_health');
  if (error) throw new Error(error.message);
  return data as PriceHealthReport;
}

/** Database size against the free tier's hard stop, and what is taking the room. */
export async function fetchDatabaseUsage(): Promise<DatabaseUsage> {
  const { data, error } = await supabase.rpc('database_usage');
  if (error) throw new Error(error.message);
  return data as DatabaseUsage;
}

/**
 * Whose prices these are, and who we actually fetch them from.
 *
 * Read straight from price_source rather than an RPC: it is four rows of reference data that
 * any signed-in account may already read, and wrapping it would add a function to maintain
 * for no gain.
 */
export async function fetchPriceProvenance(): Promise<PriceProvenance[]> {
  const { data, error } = await supabase
    .from('price_source')
    .select('key,label,currency,price_basis,feed_label,feed_url,feed_note')
    .order('id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    key: r.key,
    label: r.label,
    currency: r.currency,
    priceBasis: r.price_basis,
    feedLabel: r.feed_label,
    feedUrl: r.feed_url,
    feedNote: r.feed_note,
  }));
}

/** Price coverage per set, worst first. The figure that reveals a whole set going missing. */
export async function fetchSetCoverage(): Promise<SetCoverageRow[]> {
  const { data, error } = await supabase.rpc('set_coverage');
  if (error) throw new Error(error.message);
  return (data ?? []) as SetCoverageRow[];
}

export interface CardArtStatus {
  total: number;
  present: number;
  missing: number;
  durationMs: number;
  cards: { id: string; tcg: number | null }[];
}

/** Which cards have no thumbnail in the bucket, and the product id needed to fetch them. */
export async function fetchCardArtStatus(): Promise<CardArtStatus> {
  const { data, error } = await supabase.functions.invoke('card-art-status', { body: {} });
  if (error) return detailed(error);
  return data as CardArtStatus;
}

/**
 * Fills the gaps by asking for each missing thumbnail once.
 *
 * There is no sync endpoint to call. The Worker captures and converts a card the first time
 * anything requests it, so requesting it *is* the sync -- this just does it deliberately
 * rather than waiting for someone to scroll past the card. Nothing is uploaded from here;
 * the bytes travel upstream to the edge and into the bucket without passing through the
 * browser.
 *
 * The product id rides along for the newest sets, where images.pokemontcg.io has nothing and
 * TCGplayer is the only source.
 *
 * Eight at a time: enough to finish 191 cards in well under a minute, few enough to stay a
 * polite neighbour to two free services.
 */
export async function syncCardArt(
  cards: { id: string; tcg: number | null }[],
  onProgress?: (done: number, failed: number) => void,
): Promise<{ done: number; failed: number }> {
  const base = import.meta.env.VITE_IMAGE_BASE_URL ?? '';
  const safe = (v: string) =>
    v.replace(/[^a-zA-Z0-9.-]/g, (c) => '_' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));

  let next = 0;
  let done = 0;
  let failed = 0;

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= cards.length) return;
      const card = cards[i];
      const url = `${base}/cards/${safe(card.id)}.avif` + (card.tcg ? `?tcg=${card.tcg}` : '');
      try {
        // HEAD, because the capture happens on the server either way and the bytes would
        // only be thrown away here.
        const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (res.ok) done++;
        else failed++;
      } catch {
        failed++;
      }
      onProgress?.(done, failed);
    }
  };

  await Promise.all(Array.from({ length: Math.min(8, cards.length) }, worker));
  return { done, failed };
}
