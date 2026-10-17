/* Derivations shared by the three layout proposals, so they disagree about presentation
   and not about facts. Every number here comes from data.js, which is a real snapshot. */
window.ops = (function () {
  const { health, usage, coverage, calendar } = window.OPS;

  const fmt = (n) => Number(n).toLocaleString();

  /** Where a set's price coverage sits. Null means nothing in it is mapped at all. */
  function band(pct) {
    if (pct === null || pct === undefined) return 'var(--raised)';
    if (pct >= 100) return 'var(--ok)';
    if (pct >= 90) return 'var(--warn)';
    return 'var(--crit)';
  }

  function stamp() {
    const d = health.lastRunOn ? new Date(health.lastRunOn + 'T00:00:00') : new Date();
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /**
   * The scheduled jobs, with their recent outcomes.
   *
   * sync_calendar returns one track per job with a day array; a day with no row means the
   * job did not run, which is not the same as a failure and is not drawn as one.
   */
  /** What each scheduled job is called, since the track's own label is the price source. */
  const JOB_NAMES = { prices: 'Daily price capture', thin: 'Nightly history thinning' };

  function jobs() {
    return (calendar || []).map((track) => {
      const days = (track.days || []).slice(-30);
      // A day with no row means the job did not run. That is not a failure and is not
      // drawn as one -- an empty tick reads as "nothing happened", which is the truth.
      const ticks = days.map((d) => (d.status === 'ok' ? 'ok' : d.status === 'fail' ? 'crit' : ''));
      const ran = days.filter((d) => d.status && d.status !== 'none');
      const last = ran[ran.length - 1];
      const gap = last ? Math.round((Date.now() - new Date(last.day + 'T12:00:00')) / 86400000) : null;
      return {
        job: track.job,
        label: JOB_NAMES[track.job] || track.job,
        state: !last ? '' : last.status === 'ok' ? 'ok' : 'crit',
        when: gap === null ? 'never run' : gap <= 0 ? 'ran today' : gap === 1 ? 'ran yesterday' : `${gap} days ago`,
        ran: ran.length,
        rows: last && last.rows != null ? fmt(last.rows) : '—',
        ms: last && last.ms != null ? (last.ms / 1000).toFixed(1) + 's' : '—',
        ticks: ticks.length ? ticks : Array(30).fill(''),
      };
    });
  }

  /** The catalogue in figures, in the order an operator would read them. */
  function catalogue() {
    return [
      ['Printings', fmt(health.totalPrintings)],
      ['Mapped to a product', fmt(health.mappedPrintings)],
      ['Carrying a price', fmt(health.pricedPrintings)],
      ['Covered by last run', fmt(health.coveredByLastRun)],
      ['History rows', fmt(health.historyRows)],
      ['History spans', `${health.oldestPoint} → ${health.newestPoint}`],
    ];
  }

  /**
   * What an operator would act on, worst first.
   *
   * Only things that are actually true of this data. An empty list is a real outcome and
   * the layouts say so rather than inventing something to fill the panel.
   */
  function conditions() {
    const out = [];
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
    if (usage.pct > 65) {
      out.push({
        key: 'storage',
        level: usage.pct > 85 ? 'crit' : 'warn',
        what: `Storage at ${usage.pct}%`,
        why: `${usage.pretty} of ${usage.limitPretty}. Thinning history is what brings this down.`,
      });
    }
    return out;
  }

  /**
   * A day-by-day series for the strip charts.
   *
   * Real recorded values, including the days nothing ran -- those come back as null rather
   * than zero, because a gap in a chart and a zero in a chart mean different things and
   * only one of them is true here.
   */
  function series(job, field = 'rows') {
    const track = (calendar || []).find((t) => t.job === job);
    if (!track) return [];
    // Start at the first day anything ran. sync_calendar returns a fixed window, and this
    // system has only been recording for a fortnight -- plotting the empty weeks before
    // that makes the axis describe the query rather than the data.
    const all = track.days || [];
    const first = all.findIndex((d) => d.status && d.status !== 'none');
    return (first === -1 ? all.slice(-45) : all.slice(first)).map((d) => ({
      day: d.day,
      v: d.status && d.status !== 'none' ? (d[field] ?? 0) : null,
      status: d.status || 'none',
      note: d.note || null,
    }));
  }

  return { fmt, band, stamp, jobs, catalogue, conditions, series, health, usage, coverage, calendar };
})();
