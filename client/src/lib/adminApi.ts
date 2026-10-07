/**
 * The admin side: running the daily jobs, and seeing what they did.
 *
 * Everything here is gated twice, deliberately. The interface hides these controls from
 * anyone who is not an admin, and the Edge Function and the row policies refuse them anyway
 * — hiding a button is a courtesy to the reader, not a security measure, and neither the
 * function nor Postgres has any idea what the interface chose to draw.
 */
import { supabase } from './supabase';
import type { DatabaseUsage, PriceHealthReport, SetCoverageRow, SyncTrack } from '../types';

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
    bands: { fromAge: number; toAge: number; keepEvery: number; removed: number }[];
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

/** Price coverage per set, worst first. The figure that reveals a whole set going missing. */
export async function fetchSetCoverage(): Promise<SetCoverageRow[]> {
  const { data, error } = await supabase.rpc('set_coverage');
  if (error) throw new Error(error.message);
  return (data ?? []) as SetCoverageRow[];
}
