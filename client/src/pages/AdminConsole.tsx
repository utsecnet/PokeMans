/**
 * The admin console.
 *
 * Three columns that do not scroll: the figures on the left, the jobs and controls on the
 * right, and in the middle whatever you clicked. The rails are instruments — they report a
 * number and hand you a way in — and the centre is the only pane that explains anything.
 *
 * It replaced a page of stacked boxes where every section told its own story in place and
 * the one you wanted was always below the fold.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  fetchCardArtStatus,
  fetchDatabaseUsage,
  fetchPriceHealth,
  fetchPriceProvenance,
  fetchSetCoverage,
  fetchSetPrintings,
  fetchStalePrintings,
  fetchSyncCalendar,
  runHistoryThinning,
  runPriceSync,
  runPriceSyncToCompletion,
  syncCardArt,
  type CardArtStatus,
  type SetPrinting,
  type StalePrinting,
} from '../lib/adminApi';
import type {
  DatabaseUsage,
  PriceHealthReport,
  PriceProvenance,
  SetCoverageRow,
  SyncTrack,
} from '../types';
import { Inspector, type Target } from '../components/console/Inspector';
import { band, conditionsFrom, fmt, jobsFrom } from '../components/console/consoleData';
import '../styles/console.css';

/** The set map: 176 cells, one per set, fill height is how much of it carries a price. */
function SetMap({
  sets, current, onPick,
}: {
  sets: SetCoverageRow[];
  current: string | null;
  onPick: (setId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Square cells and a minimum column width cannot both be honoured in a fixed pane, and
  // a minimum width gives by scrolling. So the column count is solved for instead of
  // declared: try every count, keep the one that leaves the squares biggest.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const GAP = 3;
    const fit = () => {
      const n = sets.length;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!n || w < 1 || h < 1) return;
      let best = { size: 0, cols: 1 };
      for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const size = Math.min((w - (cols - 1) * GAP) / cols, (h - (rows - 1) * GAP) / rows);
        if (size > best.size) best = { size, cols };
      }
      const px = Math.min(Math.max(Math.floor(best.size), 1), 40);
      el.style.gridTemplateColumns = `repeat(${best.cols}, ${px}px)`;
      el.style.gridAutoRows = `${px}px`;
    };
    // Safe against a feedback loop: the map is sized by its parent, so changing the track
    // sizes cannot change the box being measured.
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [sets.length]);

  return (
    <div className="map" ref={ref}>
      {sets.map((s) => (
        <button
          key={s.setId}
          type="button"
          aria-current={current === s.setId}
          aria-label={`${s.name}, ${s.pct === null ? 'no printings' : `${s.pct}% priced`}`}
          title={`${s.name} — ${s.priced}/${s.printings} priced${s.pct === null ? '' : ` (${s.pct}%)`}`}
          onClick={() => onPick(s.setId)}
          style={{ '--cell': band(s.pct), '--fill': `${Math.max(s.pct ?? 0, 4)}%` } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

interface LogLine {
  at: Date;
  text: string;
  bad?: boolean;
}

export function AdminConsole() {
  const [health, setHealth] = useState<PriceHealthReport | null>(null);
  const [coverage, setCoverage] = useState<SetCoverageRow[] | null>(null);
  const [calendar, setCalendar] = useState<SyncTrack[] | null>(null);
  const [usage, setUsage] = useState<DatabaseUsage | null>(null);
  const [sources, setSources] = useState<PriceProvenance[] | null>(null);
  const [art, setArt] = useState<CardArtStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [trail, setTrail] = useState<Target[]>([{ key: 'overview' }]);
  const target = trail[trail.length - 1];
  const go = useCallback((t: Target) => {
    setTrail((prev) => {
      const top = prev[prev.length - 1];
      return top.key === t.key && top.arg === t.arg ? prev : [...prev, t];
    });
  }, []);
  const back = useCallback(() => setTrail((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev)), []);

  const [log, setLog] = useState<LogLine[]>([]);
  const say = useCallback((text: string, bad?: boolean) =>
    setLog((prev) => [{ at: new Date(), text, bad }, ...prev].slice(0, 60)), []);

  const [busy, setBusy] = useState<string | null>(null);
  const [artProgress, setArtProgress] = useState<{ done: number; total: number } | null>(null);

  const refresh = useCallback(async () => {
    const [h, c, cal, u] = await Promise.all([
      fetchPriceHealth(), fetchSetCoverage(), fetchSyncCalendar(60), fetchDatabaseUsage(),
    ]);
    setHealth(h);
    setCoverage(c);
    setCalendar(cal);
    setUsage(u);
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh().catch((e) => { if (!cancelled) setLoadError(e.message); });
    fetchPriceProvenance().then((s) => { if (!cancelled) setSources(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [refresh]);

  /* The console sits below the site header, and wants the rest of the window exactly. */
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => el.style.setProperty('--console-top', `${el.getBoundingClientRect().top + window.scrollY}px`);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  /* Per-set printings, fetched when a set is opened and kept for the session. All 33,336
     at once would be a megabyte to answer a question about one set. */
  const printCache = useRef(new Map<string, SetPrinting[]>());
  const [printings, setPrintings] = useState<SetPrinting[] | null>(null);
  const [printingsLoading, setPrintingsLoading] = useState(false);
  const [printingsError, setPrintingsError] = useState<string | null>(null);

  useEffect(() => {
    if (target.key !== 'set' || !target.arg) return;
    const id = target.arg;
    const hit = printCache.current.get(id);
    setPrintingsError(null);
    if (hit) { setPrintings(hit); setPrintingsLoading(false); return; }
    let cancelled = false;
    setPrintings(null);
    setPrintingsLoading(true);
    fetchSetPrintings(id)
      .then((rows) => { if (cancelled) return; printCache.current.set(id, rows); setPrintings(rows); })
      .catch((e) => { if (!cancelled) setPrintingsError(e.message); })
      .finally(() => { if (!cancelled) setPrintingsLoading(false); });
    return () => { cancelled = true; };
  }, [target.key, target.arg]);

  /* The stale list, read once when it is first asked for. */
  const [stale, setStale] = useState<StalePrinting[] | null>(null);
  const [staleLoading, setStaleLoading] = useState(false);
  const [staleError, setStaleError] = useState<string | null>(null);

  useEffect(() => {
    if (target.key !== 'stale' || stale || staleLoading || !health?.lastRunOn) return;
    // The same cut the health figure uses, reconstructed from the two fields that encode
    // it: the report's day is lastRunOn plus the days since. Measuring from the newest
    // point instead drifts by a day the moment a night is missed, and then the list and
    // the number beside it disagree.
    const cut = new Date(health.lastRunOn + 'T00:00:00');
    cut.setDate(cut.getDate() + (health.daysSinceLastRun ?? 0) - 3);
    setStaleLoading(true);
    fetchStalePrintings(cut.toISOString().slice(0, 10))
      .then(setStale)
      .catch((e) => setStaleError(e.message))
      .finally(() => setStaleLoading(false));
  }, [target.key, stale, staleLoading, health?.lastRunOn, health?.daysSinceLastRun]);

  /* ------------------------------------------------------------------ actions */

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      say((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  const actions: Record<string, { label: string; busyLabel: string; go?: boolean; fn: () => Promise<void> }> = {
    prices: {
      label: 'Capture prices', busyLabel: 'Capturing…', go: true,
      async fn() {
        const r = await runPriceSyncToCompletion((p) => {
          if (p.skipped) say(p.note ?? 'Already captured today');
          else say(`Capture prices · ${fmt(p.setsFetched)} sets, ${fmt(p.changed ?? 0)} changed, ${fmt(p.remaining)} left`);
        });
        say(`Capture prices · finished ${r.status === 'ok' ? 'cleanly' : `with ${fmt(r.failures)} failures`}`, r.status !== 'ok');
        await refresh();
      },
    },
    force: {
      label: 'Re-capture today', busyLabel: 'Re-capturing…',
      async fn() {
        const r = await runPriceSync({ force: true });
        say(`Re-capture today · ${fmt(r.setsFetched)} sets, ${fmt(r.changed ?? 0)} changed`);
        await refresh();
      },
    },
    'thin-dry': {
      label: 'Preview thinning', busyLabel: 'Checking…',
      async fn() {
        const r = await runHistoryThinning(true);
        say(`Preview thinning · ${fmt(r.removed)} points would go, ${fmt(r.after)} kept`);
        for (const b of r.bands) if (b.removed) say(`  ${b.band} · keep ${b.keep} · ${fmt(b.removed)} would go`);
      },
    },
    thin: {
      label: 'Thin history', busyLabel: 'Thinning…',
      async fn() {
        const r = await runHistoryThinning(false);
        say(`Thin history · ${fmt(r.removed)} points removed, ${fmt(r.after)} kept`);
        await refresh();
      },
    },
    'art-check': {
      label: 'Check card art', busyLabel: 'Checking…',
      async fn() {
        const s = await fetchCardArtStatus();
        setArt(s);
        say(`Check card art · ${fmt(s.missing)} of ${fmt(s.total)} cards have no thumbnail`);
        go({ key: 'art' });
      },
    },
    'art-sync': {
      label: 'Sync missing art', busyLabel: 'Syncing…',
      async fn() {
        if (!art?.missing) return;
        setArtProgress({ done: 0, total: art.cards.length });
        say(`Sync card art · ${fmt(art.cards.length)} queued`);
        const { done, failed } = await syncCardArt(art.cards, (d, f) =>
          setArtProgress({ done: d + f, total: art.cards.length }));
        setArtProgress(null);
        say(`Sync card art · ${fmt(done)} fetched and converted${failed ? `, ${fmt(failed)} with no source yet` : ''}`);
        const s = await fetchCardArtStatus();
        setArt(s);
      },
    },
  };

  /* ------------------------------------------------------------------ render */

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-semibold">Console</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{loadError}</p>
      </div>
    );
  }

  if (!health || !coverage || !calendar || !usage) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-[var(--color-text-muted)]">
        Reading the catalogue…
      </div>
    );
  }

  const jobs = jobsFrom(calendar);
  const conds = conditionsFrom(health, coverage, usage);
  const byDate = [...coverage].sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? ''));
  const coveragePct = Math.round((health.pricedPrintings / health.totalPrintings) * 100);
  const freshness = health.pricedPrintings
    ? Math.round((health.coveredByLastRun / health.pricedPrintings) * 100) : 0;
  const unmapped = health.totalPrintings - health.mappedPrintings;

  const signals: { key: string; k: string; v: string; h: string; warn?: boolean }[] = [
    { key: 'coverage', k: 'Coverage', v: `${coveragePct}%`, h: `${fmt(health.pricedPrintings)} of ${fmt(health.totalPrintings)} printings`, warn: coveragePct < 70 },
    { key: 'freshness', k: 'Last run covered', v: `${freshness}%`, h: health.daysSinceLastRun === 0 ? 'ran today' : health.daysSinceLastRun === 1 ? 'ran yesterday' : health.daysSinceLastRun === null ? 'never run' : `ran ${health.daysSinceLastRun} days ago`, warn: freshness < 90 },
    { key: 'stale', k: 'Stale over 3 days', v: fmt(health.staleOver3Days), h: 'not seen by a recent run', warn: health.staleOver3Days > 0 },
    { key: 'unmapped', k: 'Not mapped to a product', v: fmt(unmapped), h: 'will never price until the map changes', warn: unmapped > 0 },
    { key: 'history', k: 'History', v: fmt(health.historyRows), h: health.oldestPoint ? `since ${health.oldestPoint}` : 'no points yet' },
    { key: 'storage', k: 'Storage', v: `${usage.pctUsed}%`, h: `${usage.pretty} of ${usage.limitPretty}`, warn: usage.pctUsed > 65 },
    { key: 'art', k: 'Card art', v: art ? fmt(art.missing) : '—', h: art ? `missing of ${fmt(art.total)} cards` : 'not checked this session' },
  ];

  const pct = artProgress && artProgress.total
    ? Math.round((artProgress.done / artProgress.total) * 100) : 0;

  return (
    <div className="console" ref={rootRef}>
      <div className="col left">
        <section className="panel">
          <h2>Signals<span className="spacer" /><span className="faint">click to inspect</span></h2>
          <div className="body flush">
            {signals.map((s) => (
              <button
                key={s.key}
                type="button"
                className="sig"
                aria-current={target.key === s.key}
                onClick={() => go({ key: s.key })}
              >
                <span className="k">{s.k}</span>
                <span className={s.warn ? 'v warn' : 'v'}>{s.v}</span>
                <span className="h">{s.h}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>
            Sets <b>{coverage.length}, oldest first</b>
            <span className="spacer" />
            <button type="button" className="linky" onClick={() => go({ key: 'coverage' })}>as a table</button>
          </h2>
          <div className="body" style={{ display: 'flex', overflow: 'hidden', paddingBottom: 4 }}>
            <SetMap
              sets={byDate}
              current={target.key === 'set' ? target.arg ?? null : null}
              onPick={(setId) => go({ key: 'set', arg: setId })}
            />
          </div>
          <div className="legend">
            <span><b style={{ background: 'var(--ok)' }} />100%</span>
            <span><b style={{ background: 'var(--warn)' }} />90–99%</span>
            <span><b style={{ background: 'var(--crit)' }} />below 90%</span>
            <span><b style={{ background: 'var(--raised)' }} />none</span>
          </div>
        </section>
      </div>

      <Inspector
        target={target}
        canGoBack={trail.length > 1}
        onBack={back}
        go={go}
        health={health}
        coverage={coverage}
        calendar={calendar}
        usage={usage}
        sources={sources}
        art={art}
        printings={printings}
        printingsLoading={printingsLoading}
        printingsError={printingsError}
        stale={stale}
        staleLoading={staleLoading}
        staleError={staleError}
      />

      <div className="col right">
        <section className="panel">
          <h2>Scheduled jobs<span className="spacer" /><span className="faint">click a day</span></h2>
          <div className="body flush">
            {jobs.map((j, i) => (
              <div className="job" key={j.job}>
                <div className="top">
                  <i className={`dot ${j.state}`} />
                  <button type="button" className="name" onClick={() => go({ key: 'job', arg: String(i) })}>
                    {j.label}
                  </button>
                  <span className="when">{j.when}</span>
                </div>
                <div className="kv" style={{ paddingTop: 3 }}>
                  <span>last run wrote</span><b>{j.rows} rows in {j.ms}</b>
                </div>
                <div className="ticks">
                  {j.ticks.map((t, d) => (
                    <button
                      key={d}
                      type="button"
                      className={t.state}
                      disabled={!t.day}
                      aria-label={t.day ? `${t.day.day}, ${t.day.status}` : 'did not run'}
                      onClick={() => t.day && go({ key: 'run', arg: `${i}:${t.day.day}` })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Conditions <b>{conds.length ? `${conds.length} open` : 'all clear'}</b></h2>
          <div className="body flush">
            {/* The headline only. Why it is true, and what to do about it, is the centre
                pane's job — repeating it here is what made the old page tall. */}
            {conds.map((c) => (
              <button key={c.key} type="button" className="cond" onClick={() => go({ key: c.key })}>
                <i className={`dot ${c.level}`} />
                <span>{c.what}</span>
              </button>
            ))}
            {!conds.length && (
              <div className="cond" style={{ cursor: 'default' }}>
                <i className="dot ok" />
                <span>Nothing to do</span>
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <h2>Run a job</h2>
          <div className="acts">
            {['prices', 'force', 'thin-dry', 'thin'].map((k) => (
              <button
                key={k}
                type="button"
                className={actions[k].go ? 'btn go' : 'btn'}
                disabled={busy !== null}
                onClick={() => run(k, actions[k].fn)}
              >
                {busy === k ? actions[k].busyLabel : actions[k].label}
              </button>
            ))}
            <hr />
            <button type="button" className="btn" disabled={busy !== null} onClick={() => run('art-check', actions['art-check'].fn)}>
              {busy === 'art-check' ? 'Checking…' : 'Check card art'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy !== null || !art || art.missing === 0}
              onClick={() => run('art-sync', actions['art-sync'].fn)}
            >
              {busy === 'art-sync' ? 'Syncing…' : 'Sync missing art'}
            </button>
            <span className="note">
              {art
                ? `${fmt(art.present)} held of ${fmt(art.total)} cards · ${fmt(art.missing)} missing`
                : 'Card art has not been checked this session.'}
            </span>
          </div>
          {artProgress && (
            <div className="bars">
              <div className="meter"><i style={{ width: `${pct}%` }} /></div>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Output <span className="spacer" /><span className="faint">this session</span></h2>
          <div className="log">
            {log.length === 0 && <div className="empty">Nothing run yet. Job results appear here.</div>}
            {log.map((l, i) => (
              <div key={i}>
                <time>{l.at.toLocaleTimeString(undefined, { hour12: false })}</time>
                <span className={l.bad ? 'bad' : undefined}>{l.text}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
