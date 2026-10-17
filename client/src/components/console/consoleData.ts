/**
 * The console's derived readings: the figures the rails show and the conditions it opens
 * on, worked out once so the rail and the inspector cannot disagree about them.
 */
import type {
  DatabaseUsage,
  PriceHealthReport,
  SetCoverageRow,
  SyncDay,
  SyncTrack,
} from '../../types';

export const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString();

export const money = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : '$' + Number(v).toFixed(2);

export const pretty = (day: string | null | undefined) =>
  day
    ? new Date(day + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

export const longDay = (day: string) =>
  new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

/** Where a set's coverage sits. Null means it has no printings to cover. */
export function band(pct: number | null): string {
  if (pct === null || pct === undefined) return 'var(--raised)';
  if (pct >= 100) return 'var(--ok)';
  if (pct >= 90) return 'var(--warn)';
  return 'var(--crit)';
}

/** What each scheduled job is called, since the track's own label names the price source. */
const JOB_NAMES: Record<string, string> = {
  prices: 'Daily price capture',
  thin: 'Nightly history thinning',
};

export interface JobRow {
  job: string;
  label: string;
  state: '' | 'ok' | 'crit';
  when: string;
  runs: number;
  rows: string;
  ms: string;
  /** The last 30 days, in order. An empty tick is a day the job did not run. */
  ticks: { day: SyncDay | null; state: '' | 'ok' | 'crit' }[];
}

export function jobsFrom(calendar: SyncTrack[]): JobRow[] {
  return calendar.map((track) => {
    const days = (track.days ?? []).slice(-30);
    const ran = days.filter((d) => d.status && d.status !== 'none');
    const last = ran[ran.length - 1];
    const gap = last ? Math.round((Date.now() - new Date(last.day + 'T12:00:00').getTime()) / 86400000) : null;
    return {
      job: track.job,
      label: JOB_NAMES[track.job] ?? track.job,
      state: !last ? '' : last.status === 'ok' ? 'ok' : 'crit',
      when: gap === null ? 'never run' : gap <= 0 ? 'ran today' : gap === 1 ? 'ran yesterday' : `ran ${gap} days ago`,
      runs: ran.length,
      rows: last?.rows != null ? fmt(last.rows) : '—',
      ms: last?.ms != null ? (last.ms / 1000).toFixed(1) + 's' : '—',
      // A day with no row means the job did not run. That is not a failure and is not
      // drawn as one: an empty tick reads as "nothing happened", which is the truth.
      ticks: days.map((d) => ({
        day: d.status && d.status !== 'none' ? d : null,
        state: d.status === 'ok' ? 'ok' : d.status === 'error' || d.status === 'warn' ? 'crit' : '',
      })),
    };
  });
}

export type ConditionKey = 'stale' | 'dark' | 'thin' | 'unmapped' | 'storage';

export interface Condition {
  key: ConditionKey;
  level: 'warn' | 'crit';
  what: string;
  why: string;
}

/**
 * What an operator would act on, worst first.
 *
 * Only things that are true of this data. An empty list is a real outcome and the console
 * says so rather than inventing something to fill the panel.
 */
export function conditionsFrom(
  health: PriceHealthReport,
  coverage: SetCoverageRow[],
  usage: DatabaseUsage,
): Condition[] {
  const out: Condition[] = [];
  const unmapped = health.totalPrintings - health.mappedPrintings;
  const dark = coverage.filter((s) => s.pct === null || s.priced === 0);
  const thin = coverage.filter((s) => s.pct !== null && s.pct < 90);

  if (health.staleOver3Days > 0) {
    out.push({
      key: 'stale',
      level: health.staleOver3Days > 100 ? 'crit' : 'warn',
      what: `${fmt(health.staleOver3Days)} prices older than three days`,
      why: 'The source publishes a set at a time; a set it skips goes stale until the next run picks it up.',
    });
  }
  if (dark.length) {
    out.push({
      key: 'dark',
      level: 'crit',
      what: `${dark.length} ${dark.length === 1 ? 'set carries' : 'sets carry'} no price at all`,
      why: 'Nothing in them is mapped to a product, so a price has nowhere to land.',
    });
  }
  if (thin.length) {
    out.push({
      key: 'thin',
      level: 'warn',
      what: `${thin.length} sets below 90% priced`,
      why: 'Usually printings the source does not publish separately, rather than a fault.',
    });
  }
  if (unmapped > 0) {
    out.push({
      key: 'unmapped',
      level: 'warn',
      what: `${fmt(unmapped)} printings not mapped to a product`,
      why: 'Mostly subtypes the price feed does not break out. They will never price until the map changes.',
    });
  }
  if (usage.pctUsed > 65) {
    out.push({
      key: 'storage',
      level: usage.pctUsed > 85 ? 'crit' : 'warn',
      what: `Storage at ${usage.pctUsed}%`,
      why: `${usage.pretty} of ${usage.limitPretty}. Thinning history is what brings this down.`,
    });
  }
  return out;
}
