import { useState } from 'react';
import { refreshAccountQuota } from '../lib/api';
import type { ApiQuota } from '../types';

/** "in 3 hours", "in 12 minutes" — how long the allowance has left before it resets. */
function untilReset(iso: string | null) {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  return `in ${Math.round(hours / 24)} days`;
}

function observedAgo(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * How much of an API allowance is spent.
 *
 * The figures are whatever the provider last reported in passing — nothing here polls, and
 * nothing is fetched when Settings opens. On a 100-call-a-day tier a page that checked on
 * every visit would spend the very thing it is reporting, so refreshing is a button the
 * user presses, labelled with what it costs.
 */
export function ApiQuotaMeter({
  service,
  quota: initial,
}: {
  service: string;
  quota: ApiQuota;
}) {
  const [quota, setQuota] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { dailyLimit, dailyRemaining, purchasedRemaining, stale } = quota;
  const known = dailyLimit != null && dailyRemaining != null;
  // After a reset the stored remaining is certainly too low, so the bar isn't drawn from it.
  const used = known && !stale ? Math.max(0, dailyLimit - dailyRemaining) : null;
  const pct = used != null && dailyLimit ? Math.min(100, (used / dailyLimit) * 100) : 0;

  // Colour is the warning, so it earns its place rather than decorating: amber once most of
  // the day's calls are gone, red once they all are.
  const exhausted = used != null && dailyLimit != null && used >= dailyLimit;
  const low = used != null && dailyLimit != null && used / dailyLimit >= 0.8;
  const barColor = exhausted ? 'bg-red-500' : low ? 'bg-amber-500' : 'bg-emerald-500';

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await refreshAccountQuota(service);
      if (res.quota) setQuota(res.quota);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the allowance');
    } finally {
      setBusy(false);
    }
  };

  const reset = untilReset(quota.resetsAt);

  return (
    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs font-medium">Daily API credits</span>
        {known && (
          <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
            {stale ? (
              /* The allowance rolled over since this reading; the old number would read as
                 "you have none left" on a day that has barely started. */
              <>not checked since reset · {dailyLimit} per day</>
            ) : (
              <>
                <span
                  className={`font-semibold ${
                    exhausted
                      ? 'text-red-600 dark:text-red-400'
                      : low
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-[var(--color-text)]'
                  }`}
                >
                  {used}
                </span>{' '}
                of {dailyLimit} used
              </>
            )}
          </span>
        )}
      </div>

      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${stale ? 'bg-[var(--color-border)]' : barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-muted)]">
        <span>
          {!stale && known && (
            <>
              {dailyRemaining} left
              {reset ? ` · resets ${reset}` : ''}
              {/* Bought credits sit outside the daily allowance and don't reset, so they
                  are named separately rather than added into the total. */}
              {purchasedRemaining != null && purchasedRemaining > 0 && (
                <> · {purchasedRemaining} purchased</>
              )}
            </>
          )}
          {stale && reset && <>resets {reset}</>}
        </span>
        <span className="flex items-center gap-2">
          <span title={new Date(quota.observedAt).toLocaleString()}>
            seen {observedAgo(quota.observedAt)}
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            title="Ask the service now. This uses one credit unless the allowance is already spent."
            className="rounded border border-[var(--color-border)] px-1.5 py-0.5 transition hover:text-[var(--color-text)] disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Check now'}
          </button>
        </span>
      </div>

      {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
