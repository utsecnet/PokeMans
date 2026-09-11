import type { SourceState, SyncStatus } from '../types';

/**
 * One row per data source, each stating what it holds, where it comes from, and when it last
 * ran — so the page answers "what does this button actually do?" by showing it, rather than
 * by explaining it in a paragraph above three identical buttons.
 */
type SourceId = SourceState['id'];

const SOURCES: {
  id: SourceId;
  name: string;
  provides: string;
  origins: string[];
  action: string;
  note?: string;
}[] = [
  {
    id: 'pokeapi',
    name: 'Pokédex',
    provides: 'Species, stats, types, abilities, evolutions',
    origins: ['pokeapi.co', 'raw.githubusercontent.com/PokeAPI/sprites'],
    action: 'Sync',
  },
  {
    id: 'tcg',
    name: 'Cards',
    // Deliberately spelled out: this one button runs two jobs against two different sources,
    // which is invisible otherwise and the most confusing thing on the page.
    provides: 'Card records and artwork, then printing variants and lighter images',
    origins: ['raw.githubusercontent.com/PokemonTCG', 'images.pokemontcg.io', 'api.tcgdex.net'],
    action: 'Sync',
  },
  {
    id: 'logos',
    name: 'Set logos',
    provides: 'Set symbols and logos, stored on the device instead of fetched per view',
    origins: ['images.pokemontcg.io', 'assets.tcgdex.net'],
    action: 'Sync',
    note: 'Run after a card sync adds new sets',
  },
  {
    id: 'prices',
    name: 'Prices',
    provides: 'Market prices for the cards you own',
    origins: ['api.tcgdex.net', 'pokemonpricetracker.com'],
    action: 'Refresh',
    note: 'Runs automatically once a day',
  },
];

function relativeDay(iso: string | null) {
  if (!iso) return 'never';
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function StatusDot({ status, running }: { status: string | undefined; running: boolean }) {
  const tone = running
    ? 'bg-amber-500 animate-pulse'
    : status === 'success'
      ? 'bg-emerald-500'
      : status === 'error'
        ? 'bg-red-500'
        : 'bg-[var(--color-border)]';
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden="true" />;
}

export function DataSources({
  sources,
  syncStatus,
  busy,
  onRun,
}: {
  sources: SourceState[];
  syncStatus: SyncStatus | null;
  busy: boolean;
  onRun: (id: SourceId) => void;
}) {
  const stateFor = (id: SourceId) => sources.find((s) => s.id === id);
  const activeSource = syncStatus?.active?.source;

  return (
    <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
      {SOURCES.map((source) => {
        const state = stateFor(source.id);
        const running = activeSource === source.id;
        const failed = state?.lastRun?.status === 'error';

        return (
          <div key={source.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <StatusDot status={state?.lastRun?.status} running={running} />
                <h3 className="text-sm font-semibold">{source.name}</h3>
                {state?.counts.map((c) => (
                  <span key={c.label} className="text-xs text-[var(--color-text-muted)]">
                    <span className="font-medium tabular-nums text-[var(--color-text)]">
                      {c.value.toLocaleString()}
                    </span>{' '}
                    {c.label}
                  </span>
                ))}
              </div>

              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{source.provides}</p>

              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {source.origins.map((origin) => (
                  <li
                    key={origin}
                    className="font-mono text-[11px] leading-4 text-[var(--color-text-muted)]"
                  >
                    {origin}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => onRun(source.id)}
                className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {running ? 'Syncing…' : source.action}
              </button>
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {failed ? (
                  <span className="text-red-600 dark:text-red-400">failed</span>
                ) : (
                  relativeDay(state?.lastRun?.startedAt ?? null)
                )}
                {source.note && ` · ${source.note}`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
