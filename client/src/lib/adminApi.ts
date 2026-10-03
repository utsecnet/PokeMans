/**
 * The admin side: running syncs, and seeing what they did.
 *
 * Everything here is gated twice, deliberately. The interface hides these controls from
 * anyone who is not an admin, and the Edge Function refuses them anyway — hiding a button
 * is a courtesy to the user, not a security measure, and the function has no idea what
 * the interface chose to draw.
 */
import { supabase } from './supabase';

export interface SyncRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  cardsSeen: number;
  pricesRead: number;
  changed: number;
  failed: number;
  status: 'running' | 'success' | 'partial' | 'error';
  error: string | null;
}

export interface PriceSyncResult {
  ok: true;
  cardsSeen: number;
  priced: number;
  changed: number;
  failed?: number;
  unmatched?: number;
  /** Cards still waiting. Non-zero means run it again. */
  remaining: number;
  note?: string;
}

/**
 * Captures today's prices for the cards people hold.
 *
 * Returns `remaining` rather than looping internally: an Edge Function has a wall-clock
 * limit, so a large backlog is several calls. The caller decides whether to keep going,
 * because it is the one that can show progress while it does.
 */
export async function runPriceSync(limit?: number): Promise<PriceSyncResult> {
  const { data, error } = await supabase.functions.invoke('sync-prices', {
    body: limit ? { limit } : {},
  });
  if (error) {
    // invoke() reports a non-2xx as a generic FunctionsHttpError; the function's own
    // message is in the response body, and is the one worth showing.
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  return data as PriceSyncResult;
}

/** Runs the capture repeatedly until nothing is left, reporting after each batch. */
export async function runPriceSyncToCompletion(
  onProgress?: (result: PriceSyncResult) => void,
): Promise<PriceSyncResult> {
  let last = await runPriceSync();
  onProgress?.(last);
  // A cap on rounds, not a `while (remaining)`. If something upstream starts failing for
  // every card, `remaining` never falls and an unbounded loop would hammer a free API
  // until the tab is closed.
  for (let round = 0; round < 20 && last.remaining > 0; round++) {
    last = await runPriceSync();
    onProgress?.(last);
  }
  return last;
}

/** Recent capture runs. Admin-only by policy, so this returns nothing for anyone else. */
export async function fetchSyncRuns(limit = 10): Promise<SyncRun[]> {
  const { data, error } = await supabase
    .from('sync_run')
    .select('id,started_at,finished_at,cards_seen,prices_read,changed,failed,status,error')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    cardsSeen: r.cards_seen,
    pricesRead: r.prices_read,
    changed: r.changed,
    failed: r.failed,
    status: r.status,
    error: r.error,
  }));
}
