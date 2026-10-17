/**
 * The centre pane: whatever was clicked, in full.
 *
 * Every instrument in the rails is a way in here, and this is the only pane that scrolls.
 * That is the whole shape of the console — the old settings page gave each figure its own
 * box and made you scroll past all of them to reach the one you wanted.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CardArtStatus, SetPrinting, StalePrinting } from '../../lib/adminApi';
import type {
  DatabaseUsage,
  PriceHealthReport,
  PriceProvenance,
  SetCoverageRow,
  SyncTrack,
} from '../../types';
import {
  band, conditionsFrom, fmt, jobsFrom, longDay, money, pretty,
} from './consoleData';

export interface Target {
  key: string;
  arg?: string;
}

interface Props {
  target: Target;
  canGoBack: boolean;
  onBack: () => void;
  go: (target: Target) => void;
  health: PriceHealthReport;
  coverage: SetCoverageRow[];
  calendar: SyncTrack[];
  usage: DatabaseUsage;
  sources: PriceProvenance[] | null;
  art: CardArtStatus | null;
  printings: SetPrinting[] | null;
  printingsLoading: boolean;
  printingsError: string | null;
  stale: StalePrinting[] | null;
  staleLoading: boolean;
  staleError: string | null;
}

function Figures({ rows }: { rows: [string, string, string?][] }) {
  return (
    <div className="figs">
      {rows.map(([k, v, tone]) => (
        <div key={k}>
          <div className="k">{k}</div>
          <div className="v" style={tone ? { color: tone } : undefined}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function Waiting({ what }: { what: string }) {
  return <p className="lede">Reading {what}…</p>;
}

export function Inspector(props: Props) {
  const { target, canGoBack, onBack, go, health, coverage, calendar, usage, sources, art } = props;
  const [filter, setFilter] = useState<'missing' | 'all'>('missing');

  // A new set opens on whichever list answers the question it raises: a short set is being
  // opened to find out what is missing from it, a complete one to look at what it holds.
  const openSet = target.key === 'set' ? coverage.find((s) => s.setId === target.arg) : undefined;
  useEffect(() => {
    if (openSet) setFilter(openSet.pct !== null && openSet.pct < 100 ? 'missing' : 'all');
  }, [openSet?.setId]); // eslint-disable-line react-hooks/exhaustive-deps

  const jobs = jobsFrom(calendar);
  const worstFirst = [...coverage].sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1));

  let title = '';
  let sub = '';
  let tools: React.ReactNode = null;
  let flush = false;
  let body: React.ReactNode = null;

  const setTable = (rows: SetCoverageRow[]) => (
    <table>
      <thead>
        <tr>
          <th>Set</th>
          <th className="n">Printings</th>
          <th className="n">Priced</th>
          <th className="n">Missing</th>
          <th className="n">Coverage</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.setId} className="go" onClick={() => go({ key: 'set', arg: s.setId })}>
            <td>{s.name}<span className="id">{s.setId}</span></td>
            <td className="n">{fmt(s.printings)}</td>
            <td className="n">{fmt(s.priced)}</td>
            <td className="n">{fmt(s.printings - s.priced)}</td>
            <td className="n" style={{ color: band(s.pct) }}>{s.pct === null ? '—' : `${s.pct}%`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  switch (target.key) {
    case 'coverage': {
      title = 'Price coverage';
      sub = `${coverage.length} sets, worst first`;
      flush = true;
      body = setTable(worstFirst);
      break;
    }

    case 'set': {
      const s = openSet;
      if (!s) { title = 'Set'; body = <p className="lede">That set is not in the coverage report.</p>; break; }
      const rows = props.printings ?? [];
      const missing = rows.filter((r) => r.market === null);
      const shown = filter === 'missing' ? missing : rows;
      title = s.name;
      sub = `${s.setId} · released ${pretty(s.releaseDate)}`;
      tools = rows.length ? (
        <span className="seg">
          <button type="button" aria-pressed={filter === 'missing'} onClick={() => setFilter('missing')}>
            Missing {missing.length}
          </button>
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All {rows.length}
          </button>
        </span>
      ) : null;
      body = (
        <>
          <Figures rows={[
            ['Cards', fmt(s.cards)],
            ['Printings', fmt(s.printings)],
            ['Carrying a price', fmt(s.priced)],
            ['Missing', fmt(s.printings - s.priced), s.printings - s.priced ? 'var(--crit)' : undefined],
            ['Coverage', s.pct === null ? '—' : `${s.pct}%`, band(s.pct)],
          ]} />
          {props.printingsLoading && <Waiting what="every printing in this set" />}
          {props.printingsError && <p className="lede" style={{ color: 'var(--crit)' }}>{props.printingsError}</p>}
          {!props.printingsLoading && !props.printingsError && (
            <table>
              <thead>
                <tr>
                  <th>No.</th><th>Card</th><th>Printing</th><th>State</th>
                  <th className="n">Market</th><th className="n">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.cardId}:${r.position}`}>
                    <td className="quiet">{r.number}</td>
                    <td>{r.name}</td>
                    <td className="quiet">{r.label}</td>
                    <td>
                      {r.market !== null
                        ? <span className="tag">priced</span>
                        : r.mapped
                          ? <span className="tag old">mapped, no price</span>
                          : <span className="tag miss">no product</span>}
                    </td>
                    <td className="n">{money(r.market)}</td>
                    <td className="n faint">{r.seen ? pretty(r.seen) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      );
      break;
    }

    case 'stale': {
      title = 'Prices older than three days';
      sub = `${fmt(health.staleOver3Days)} printings`;
      body = (
        <>
          <p className="lede">
            The source publishes a set at a time. A set it skips goes stale until a later run
            picks it up, so these are printings the recent runs did not see — not failures.
          </p>
          {props.staleLoading && <Waiting what="the stale printings" />}
          {props.staleError && <p className="lede" style={{ color: 'var(--crit)' }}>{props.staleError}</p>}
          {props.stale && (
            <table>
              <thead>
                <tr>
                  <th>Set</th><th>No.</th><th>Card</th><th>Printing</th>
                  <th className="n">Market</th><th className="n">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {props.stale.map((r) => (
                  <tr key={`${r.cardId}:${r.position}`} className="go" onClick={() => go({ key: 'set', arg: r.setId })}>
                    <td>{coverage.find((s) => s.setId === r.setId)?.name ?? r.setId}</td>
                    <td className="quiet">{r.number}</td>
                    <td>{r.name}</td>
                    <td className="quiet">{r.label}</td>
                    <td className="n">{money(r.market)}</td>
                    <td className="n" style={{ color: 'var(--warn)' }}>{pretty(r.seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      );
      break;
    }

    case 'unmapped': {
      const rows = coverage
        .map((s) => ({ s, n: s.printings - s.mapped }))
        .filter((r) => r.n > 0)
        .sort((a, b) => b.n - a.n);
      title = 'Printings not mapped to a product';
      sub = `${fmt(rows.reduce((a, r) => a + r.n, 0))} across ${rows.length} sets`;
      body = (
        <>
          <p className="lede">
            Mostly subtypes the price feed does not break out — a reverse holo it folds into the
            base card. They will never carry a price until the map changes, so they are the floor
            coverage can reach rather than a fault to clear.
          </p>
          <table>
            <thead>
              <tr><th>Set</th><th className="n">Printings</th><th className="n">Not mapped</th><th className="n">Share</th></tr>
            </thead>
            <tbody>
              {rows.map(({ s, n }) => (
                <tr key={s.setId} className="go" onClick={() => go({ key: 'set', arg: s.setId })}>
                  <td>{s.name}<span className="id">{s.setId}</span></td>
                  <td className="n">{fmt(s.printings)}</td>
                  <td className="n" style={{ color: 'var(--warn)' }}>{fmt(n)}</td>
                  <td className="n quiet">{Math.round((n / s.printings) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
      break;
    }

    case 'thin':
    case 'dark': {
      const rows = target.key === 'thin'
        ? worstFirst.filter((s) => s.pct !== null && s.pct < 90)
        : worstFirst.filter((s) => s.pct === null || s.priced === 0);
      title = target.key === 'thin' ? 'Sets below 90% priced' : 'Sets carrying no price at all';
      sub = `${rows.length} ${rows.length === 1 ? 'set' : 'sets'}`;
      body = (
        <>
          <p className="lede">
            {target.key === 'thin'
              ? 'A set matched to the wrong upstream group still looks matched. Open one and the printing list says which it is: a run of "no product" rows on cards that plainly exist upstream is a mapping fault, scattered ones are not.'
              : 'Nothing in them is mapped to a product, so a price has nowhere to land.'}
          </p>
          {setTable(rows)}
        </>
      );
      break;
    }

    case 'freshness': {
      const covered = health.coveredByLastRun;
      const held = health.pricedPrintings;
      title = 'Last run covered';
      sub = `${held ? Math.round((covered / held) * 100) : 0}% of what we hold`;
      body = (
        <>
          <Figures rows={[
            ['Covered by last run', fmt(covered)],
            ['Carrying a price', fmt(held)],
            ['Not seen', fmt(held - covered), held - covered ? 'var(--warn)' : undefined],
            ['Older than 3 days', fmt(health.staleOver3Days), health.staleOver3Days ? 'var(--warn)' : undefined],
          ]} />
          <p className="lede">
            Two facts kept apart on purpose: how complete the last run was, and how long ago it
            happened. Folded into one number, a successful run looks like a failure for most of
            every day.
          </p>
          <p className="lede">
            {fmt(held - covered)} printings were not in the last run.{' '}
            <button type="button" className="linky" onClick={() => go({ key: 'stale' })}>
              {fmt(health.staleOver3Days)} of them have gone past three days
            </button>
            , which is the figure worth watching.
          </p>
        </>
      );
      break;
    }

    case 'history': {
      const thinTrack = calendar.find((t) => t.job === 'thin');
      const runs = (thinTrack?.days ?? []).filter((d) => d.status && d.status !== 'none').slice(-14).reverse();
      title = 'Price history';
      sub = `${fmt(health.historyRows)} rows`;
      body = (
        <>
          <Figures rows={[
            ['Rows held', fmt(health.historyRows)],
            ['Oldest point', health.oldestPoint ?? '—'],
            ['Newest point', health.newestPoint ?? '—'],
            ['Largest table', usage.tables[0]?.pretty ?? '—'],
          ]} />
          <p className="lede">
            Every capture adds a point per printing. Thinning keeps a daily point for the recent
            window and thins the rest, which is what holds the table under the storage limit.
          </p>
          <table>
            <thead>
              <tr><th>Night</th><th className="n">Removed</th><th className="n">Kept</th><th className="n">Took</th><th>Note</th></tr>
            </thead>
            <tbody>
              {runs.map((d) => (
                <tr key={d.day}>
                  <td>{pretty(d.day)}</td>
                  <td className="n">{fmt(d.rows ?? 0)}</td>
                  <td className="n">{fmt(d.series ?? 0)}</td>
                  <td className="n quiet">{((d.ms ?? 0) / 1000).toFixed(1)}s</td>
                  <td className="faint">{d.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
      break;
    }

    case 'storage': {
      title = 'Storage';
      sub = `${usage.pretty} of ${usage.limitPretty}`;
      body = (
        <>
          <Figures rows={[
            ['Used', usage.pretty],
            ['Limit', usage.limitPretty],
            [
              'Share',
              `${usage.pctUsed}%`,
              usage.pctUsed > 85 ? 'var(--crit)' : usage.pctUsed > 65 ? 'var(--warn)' : undefined,
            ],
            ['Largest table', usage.tables[0]?.name ?? '—'],
          ]} />
          <p className="lede">
            The database only. File storage and bandwidth are counted separately and are not what
            price history consumes. Past the limit writes fail rather than cost money, and the
            capture stops recording.
          </p>
          <table>
            <thead><tr><th>Table</th><th className="n">Size</th><th className="n">Share of used</th></tr></thead>
            <tbody>
              {usage.tables.map((t) => (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td className="n">{t.pretty}</td>
                  <td className="n quiet">{Math.round((t.bytes / usage.bytes) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
      break;
    }

    case 'art': {
      title = 'Card art';
      sub = art ? `${fmt(art.present)} of ${fmt(art.total)} held` : 'not checked yet';
      body = (
        <>
          {art && (
            <Figures rows={[
              ['Cards in catalogue', fmt(art.total)],
              ['Thumbnails held', fmt(art.present)],
              ['Missing', fmt(art.missing), art.missing ? 'var(--warn)' : undefined],
              ['Checked in', `${(art.durationMs / 1000).toFixed(1)}s`],
            ]} />
          )}
          <p className="lede">
            A thumbnail is fetched, converted and stored the first time anyone opens the card, so
            the bucket fills by itself. <b>Sync missing art</b> in the rail does the rest in one
            go, which is usually a set that has just come out.
          </p>
          {!art && <p className="lede">Run <b>Check card art</b> to list what the bucket is missing.</p>}
          {art && art.missing > 0 && (
            <table>
              <thead><tr><th>Card</th><th className="n">Product id</th></tr></thead>
              <tbody>
                {art.cards.map((c) => (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td className="n quiet">{c.tcg ?? <span className="tag miss">none</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {art && art.missing === 0 && <p className="lede">Every card in the catalogue has a thumbnail.</p>}
        </>
      );
      break;
    }

    case 'sources': {
      title = 'Where prices come from';
      sub = sources ? (sources.length === 1 ? 'one source' : `${sources.length} sources`) : '';
      body = (
        <>
          <p className="lede">
            The chart on a card names the marketplace whose prices these are. It is not always who
            we fetch them from.
          </p>
          {!sources && <Waiting what="the price sources" />}
          {sources?.map((s) => (
            <div key={s.key}>
              <Figures rows={[['Prices', s.label], ['Currency', s.currency], ['Basis', s.priceBasis ?? '—']]} />
              <p className="lede">
                <b>{s.label}</b> prices it → <b>{s.feedLabel ?? 'fetched directly'}</b> carries it →{' '}
                <b>PokéMans</b> stores it
              </p>
              {s.feedUrl && <p className="lede faint">{s.feedUrl}</p>}
              {s.feedNote && <p className="lede">{s.feedNote}</p>}
            </div>
          ))}
        </>
      );
      break;
    }

    case 'job': {
      const i = Number(target.arg ?? 0);
      const j = jobs[i];
      const runs = (calendar[i]?.days ?? []).filter((d) => d.status && d.status !== 'none').slice(-30).reverse();
      title = j?.label ?? 'Job';
      sub = `${runs.length} runs in 30 days`;
      body = (
        <>
          <Figures rows={[
            ['Last run', j?.when ?? '—'],
            ['Rows written', j?.rows ?? '—'],
            ['Duration', j?.ms ?? '—'],
            ['Failures', fmt(runs.reduce((a, d) => a + (d.fails ?? 0), 0))],
          ]} />
          <table>
            <thead>
              <tr><th>Day</th><th>Outcome</th><th className="n">Rows</th><th className="n">Took</th><th>Note</th></tr>
            </thead>
            <tbody>
              {runs.map((d) => (
                <tr key={d.day} className="go" onClick={() => go({ key: 'run', arg: `${i}:${d.day}` })}>
                  <td>{pretty(d.day)}</td>
                  <td style={{ color: d.status === 'ok' ? 'var(--ok)' : 'var(--crit)' }}>
                    {d.status === 'ok' ? 'completed' : d.status}
                  </td>
                  <td className="n">{fmt(d.rows ?? 0)}</td>
                  <td className="n quiet">{((d.ms ?? 0) / 1000).toFixed(1)}s</td>
                  <td className="faint">{d.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
      break;
    }

    case 'run': {
      const [iStr, day] = String(target.arg ?? '').split(':');
      const i = Number(iStr);
      const d = (calendar[i]?.days ?? []).find((x) => x.day === day);
      title = jobs[i]?.label ?? 'Run';
      sub = day ? longDay(day) : '';
      body = d ? (
        <>
          <Figures rows={[
            ['Outcome', d.status === 'ok' ? 'completed' : d.status],
            ['Rows written', fmt(d.rows ?? 0)],
            ['Points held after', fmt(d.series ?? 0)],
            ['Duration', `${((d.ms ?? 0) / 1000).toFixed(1)}s`],
            ['Failures', fmt(d.fails ?? 0)],
          ]} />
          {d.note && <p className="lede">{d.note}</p>}
          <p className="lede">
            <button type="button" className="linky" onClick={() => go({ key: 'job', arg: String(i) })}>
              Every run of this job
            </button>
          </p>
        </>
      ) : <p className="lede">Nothing recorded for that day.</p>;
      break;
    }

    default: {
      const conds = conditionsFrom(health, coverage, usage);
      const last = jobs[0];
      title = 'Watch floor';
      sub = conds.length ? `${conds.length} conditions open` : 'all clear';
      body = (
        <>
          <p className="lede">
            Price capture <b>{last?.when ?? 'has never run'}</b> and wrote <b>{last?.rows ?? '—'}</b> rows
            in {last?.ms ?? '—'}. Coverage is{' '}
            <b>{Math.round((health.pricedPrintings / health.totalPrintings) * 100)}%</b> of{' '}
            {fmt(health.totalPrintings)} printings. Nothing here stops the site working.
          </p>
          <div className="brief">
            {conds.map((c) => (
              <button key={c.key} type="button" onClick={() => go({ key: c.key })}>
                <i className={`dot ${c.level}`} />
                <span>
                  <span className="what">{c.what}</span><br />
                  <span className="why">{c.why}</span>
                </span>
                <span className="arrow">→</span>
              </button>
            ))}
            {!conds.length && (
              <p className="lede">Every set priced, every job on time, storage well under the limit.</p>
            )}
          </div>
          <p className="lede" style={{ marginTop: 18 }}>
            Every figure, set, job and day on this screen opens here. Reference:{' '}
            <button type="button" className="linky" onClick={() => go({ key: 'sources' })}>
              where prices come from
            </button>
            , and the <Link to="/foil-lab" style={{ color: 'var(--accent)' }}>Foil Lab</Link>.
          </p>
        </>
      );
    }
  }

  return (
    <section className="panel">
      <div className="ihead">
        {canGoBack && (
          <button type="button" className="btn small back" onClick={onBack}>← Back</button>
        )}
        <h2>{title}</h2>
        <span className="sub">{sub}</span>
        <span className="spacer" />
        {tools}
      </div>
      <div className={flush ? 'ibody flush' : 'ibody'}>{body}</div>
    </section>
  );
}
