import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCardPriceHistory } from '../lib/api';
import type { CardPriceHistory, PriceChart, PriceSeries } from '../types';

// Plain SVG rather than a charting library: the project carries no chart dependency, and a
// banded plot is a filled path plus two edge lines per printing.
const PAD = { top: 12, right: 66, bottom: 24, left: 56 };

// Preferred plot height, with hard bounds. `maxHeight` (the card art's height) trims this
// when the key is long, so the whole block stays level with the card beside it.
const PREFERRED_HEIGHT = 210;
const MIN_HEIGHT = 130;

/**
 * The chart fills its container's width and takes whatever height is left inside the budget
 * once its key is accounted for. The viewBox is set to the measured pixel size rather than a
 * fixed one that gets stretched — scaling a fixed viewBox to a different aspect would
 * distort the text and stroke widths along with the plot.
 */
function useChartSize(
  wrapRef: React.RefObject<HTMLDivElement | null>,
  legendRef: React.RefObject<HTMLDivElement | null>,
  maxHeight: number | null,
) {
  const [size, setSize] = useState({ width: 460, height: PREFERRED_HEIGHT });

  useEffect(() => {
    const measure = () => {
      const width = Math.max(280, wrapRef.current?.clientWidth ?? 460);
      const legend = legendRef.current?.offsetHeight ?? 0;
      // The budget covers the tab strip and the key as well as the plot itself.
      const available = maxHeight == null ? PREFERRED_HEIGHT : maxHeight - legend - 34;
      const height = Math.round(Math.max(MIN_HEIGHT, Math.min(PREFERRED_HEIGHT, available)));
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (wrapRef.current) observer.observe(wrapRef.current);
    if (legendRef.current) observer.observe(legendRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [wrapRef, legendRef, maxHeight]);

  return size;
}

const COLORS = [
  '#d6394a', '#2f7fd6', '#3f9b52', '#d98c1f', '#8b5cd6',
  '#2aa39a', '#c94f9c', '#7a8b3f', '#4a6fd6', '#c96a2f',
];

// A marketplace's display name is carried on the chart itself, read from price_source,
// rather than looked up here. A hard-coded table meant adding a source in two places and
// silently showing a raw key when someone forgot the second.

// Best to worst: the band's top edge is the best condition present, its bottom the worst.
const CONDITION_RANK: Record<string, number> = {
  'Near Mint': 5,
  'Lightly Played': 4,
  'Moderately Played': 3,
  'Heavily Played': 2,
  Damaged: 1,
};

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'CA$', AUD: 'A$' };

/** Axis dates read as mm/dd; the full date stays in the hover tooltip. */
function shortDate(iso: string) {
  const [, m, d] = iso.split('-');
  return `${m}/${d}`;
}

function money(value: number, currency: string) {
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  return `${symbol}${value >= 100 ? Math.round(value) : value.toFixed(2)}`;
}

interface Band {
  key: string;
  label: string;
  points: { date: string; hi: number; lo: number }[];
  conditions: string[];
  latestHi: number | null;
  latestLo: number | null;
}

/**
 * Folds each printing's per-condition series into one high/low band. A printing quoted by
 * two marketplaces stays two bands — they're different quotes, not one range.
 */
function toBands(series: PriceSeries[]): Band[] {
  const marketplaces = new Set(series.map((s) => s.marketplace));
  const showMarketplace = marketplaces.size > 1;

  const grouped = new Map<string, PriceSeries[]>();
  for (const s of series) {
    const key = `${s.printingLabel ?? s.label}|${s.marketplace}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  }

  return [...grouped.entries()].map(([key, group]) => {
    const printing = group[0].printingLabel ?? group[0].label;
    const dates = [...new Set(group.flatMap((s) => s.points.map((p) => p.date)))].sort();
    const points = dates
      .map((date) => {
        const values = group
          .map((s) => s.points.find((p) => p.date === date)?.market)
          .filter((v): v is number => typeof v === 'number');
        if (values.length === 0) return null;
        return { date, hi: Math.max(...values), lo: Math.min(...values) };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const last = points[points.length - 1] ?? null;
    return {
      key,
      label: showMarketplace ? `${printing} · ${group[0].marketplace}` : printing,
      points,
      conditions: group
        .map((s) => s.condition)
        .filter((c): c is string => !!c)
        .sort((a, b) => (CONDITION_RANK[b] ?? 0) - (CONDITION_RANK[a] ?? 0)),
      latestHi: last?.hi ?? null,
      latestLo: last?.lo ?? null,
    };
  });
}


/**
 * How many points may carry an invisible hover target.
 *
 * Three years of daily prices across several printings is tens of thousands of nodes, and
 * the browser feels it. Past this the line is still drawn; only the per-day readout goes.
 */
const HOVER_LIMIT = 400;

/**
 * A path through the points with the corners taken off.
 *
 * Quadratic segments between the midpoints of consecutive points, which is the cheap
 * smoothing that cannot overshoot: every curve stays inside the triangle of the three points
 * that made it, so a smoothed line never dips below a price that was never paid. A spline
 * with real tension looks better on a gentle curve and invents troughs on a spiky one, which
 * on a price chart is a lie rather than a flourish.
 */
function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  if (pts.length === 2) return `M${pts[0][0]},${pts[0][1]} L${pts[1][0]},${pts[1][1]}`;

  const mid = (a: [number, number], b: [number, number]): [number, number] =>
    [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  let d = `M${pts[0][0]},${pts[0][1]}`;
  // Straight into the first midpoint, then one quadratic per interior point, using that
  // point as the control and the next midpoint as the destination.
  const first = mid(pts[0], pts[1]);
  d += ` L${first[0]},${first[1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const m = mid(pts[i], pts[i + 1]);
    d += ` Q${pts[i][0]},${pts[i][1]} ${m[0]},${m[1]}`;
  }
  const lastPt = pts[pts.length - 1];
  d += ` L${lastPt[0]},${lastPt[1]}`;
  return d;
}

/**
 * The windows offered under the chart.
 *
 * `null` means everything held. The rest are ordinary trading-chart spans, and one that
 * reaches further back than the data simply shows the data -- the caption says where it
 * starts, so a short line reads as a short history rather than a broken chart.
 */
const RANGES: { label: string; days: number | null }[] = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '1Y', days: 365 },
  { label: '3Y', days: 1095 },
  { label: 'All', days: null },
];

function Chart({ chart, maxHeight }: { chart: PriceChart; maxHeight: number | null }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const { width: WIDTH, height: HEIGHT } = useChartSize(wrapRef, legendRef, maxHeight);
  const bands = useMemo(() => toBands(chart.series), [chart.series]);

  const { dates, minY, maxY } = useMemo(() => {
    const allDates = [...new Set(bands.flatMap((b) => b.points.map((p) => p.date)))].sort();
    const visible = bands.filter((b) => !hidden.has(b.key));
    const values = visible.flatMap((b) => b.points.flatMap((p) => [p.hi, p.lo]));
    const hi = values.length ? Math.max(...values) : 1;
    // The axis always starts at zero, so the height of a band reads as its actual value
    // rather than being exaggerated by a cropped baseline.
    return { dates: allDates, minY: 0, maxY: hi * 1.1 };
  }, [bands, hidden]);

  if (dates.length === 0) return null;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (date: string) =>
    PAD.left + (dates.length === 1 ? plotW / 2 : (dates.indexOf(date) / (dates.length - 1)) * plotW);
  const y = (value: number) => PAD.top + plotH - ((value - minY) / (maxY - minY || 1)) * plotH;

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const gradientId = (i: number) => `band-${chart.service}-${i}`;
  const firstVisible = bands.findIndex((b) => !hidden.has(b.key) && b.points.some((p) => p.hi !== p.lo));
  const path = (pts: { date: string; v: number }[]) => smoothPath(pts.map((p) => [x(p.date), y(p.v)]));

  return (
    <div ref={wrapRef}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        className="block"
        role="img"
        aria-label={`Price history from ${chart.label} in ${chart.currency}`}
      >
        <defs>
          {bands.map((_, i) => (
            <linearGradient key={i} id={gradientId(i)} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS[i % COLORS.length]} stopOpacity="0.4" />
              <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity="0.06" />
            </linearGradient>
          ))}
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((t) => maxY * t).map((value, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--color-border)"
              strokeWidth="1"
            />
            <text x={0} y={y(value) + 4} fontSize="11" fontWeight="500" fill="var(--color-text)">
              {money(value, chart.currency)}
            </text>
          </g>
        ))}

        {bands.map((band, i) => {
          if (hidden.has(band.key) || band.points.length === 0) return null;
          const color = COLORS[i % COLORS.length];
          const isBand = band.points.some((p) => p.hi !== p.lo);
          const singlePoint = band.points.length === 1;
          const upper = band.points.map((p) => ({ date: p.date, v: p.hi }));
          const lower = band.points.map((p) => ({ date: p.date, v: p.lo }));

          return (
            <g key={band.key}>
              {/* A spread gets a shaded band with a line on BOTH edges — the upper is the
                  best condition, the lower the worst. One value gets a plain line, and a
                  single captured day has no line to draw so it's marked as a dot. */}
              {isBand && (
                <path
                  d={`${path(upper)} ${lower
                    .slice()
                    .reverse()
                    .map((p) => `L${x(p.date)},${y(p.v)}`)
                    .join(' ')} Z`}
                  fill={`url(#${gradientId(i)})`}
                  stroke="none"
                />
              )}
              {!singlePoint && (
                <path d={path(upper)} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
              )}
              {isBand && !singlePoint && (
                <path
                  d={path(lower)}
                  fill="none"
                  stroke={color}
                  strokeWidth="1.25"
                  strokeDasharray="3 2"
                  strokeLinejoin="round"
                />
              )}
              {/* Name what each edge means, at the latest point, rather than making the
                  reader infer it from a caption. Only for the topmost visible band, since
                  several overlapping labels would be unreadable. */}
              {isBand && i === firstVisible && (
                <>
                  <text
                    x={x(band.points[band.points.length - 1].date) + 6}
                    y={y(band.points[band.points.length - 1].hi) + 3}
                    fontSize="9"
                    fontWeight="500"
                    fill={color}
                  >
                    {band.conditions[0] ?? 'Best'}
                  </text>
                  <text
                    x={x(band.points[band.points.length - 1].date) + 6}
                    y={y(band.points[band.points.length - 1].lo) + 3}
                    fontSize="9"
                    fontWeight="500"
                    fill={color}
                    opacity="0.85"
                  >
                    {band.conditions[band.conditions.length - 1] ?? 'Worst'}
                  </text>
                </>
              )}
              {/* A marker per day turned a steady price into a bumpy dotted line, and across
                  a year the dots touched and became a band of their own. The line carries
                  the shape now. A series of one point still needs a dot, or it would draw
                  nothing at all. */}
              {singlePoint && band.points.map((p) => (
                <circle key={p.date} cx={x(p.date)} cy={y(p.hi)} r={3} fill={color} />
              ))}

              {/* Hover targets, invisible and larger than the dots were, so the figures for
                  a given day are still readable. Dropped past a few hundred points: three
                  years across several printings is tens of thousands of nodes and the
                  browser feels every one. */}
              {band.points.length <= HOVER_LIMIT && band.points.map((p) => (
                <circle key={`hit-${p.date}`} cx={x(p.date)} cy={y(p.hi)} r={5} fill="transparent">
                  <title>
                    {`${band.label}\n${p.date}\n${
                      p.hi === p.lo
                        ? money(p.hi, chart.currency)
                        : `best ${money(p.hi, chart.currency)} · worst ${money(p.lo, chart.currency)}`
                    }`}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}

        <text x={PAD.left} y={HEIGHT - 5} fontSize="11" fontWeight="500" fill="var(--color-text)">
          {shortDate(dates[0])}
        </text>
        {dates.length > 1 && (
          <text
            x={WIDTH - PAD.right}
            y={HEIGHT - 5}
            fontSize="11"
            fontWeight="500"
            textAnchor="end"
            fill="var(--color-text)"
          >
            {shortDate(dates[dates.length - 1])}
          </text>
        )}
      </svg>

      <div ref={legendRef} className="mt-1 space-y-0.5">
        {bands.map((band, i) => {
          const off = hidden.has(band.key);
          const spread = band.latestHi != null && band.latestLo != null && band.latestHi !== band.latestLo;
          return (
            <button
              key={band.key}
              type="button"
              onClick={() => toggle(band.key)}
              title={
                band.conditions.length
                  ? `${band.conditions.join(' → ')}\nClick to ${off ? 'show' : 'hide'}`
                  : `Click to ${off ? 'show' : 'hide'}`
              }
              className={`flex w-full items-center gap-1.5 text-left text-[10px] ${off ? 'opacity-40' : ''}`}
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              />
              <span className={`truncate ${off ? 'line-through' : ''}`}>{band.label}</span>
              {band.latestHi != null && (
                <span className="ml-auto shrink-0 tabular-nums text-[var(--color-text-muted)]">
                  {spread
                    ? `${money(band.latestLo!, chart.currency)} – ${money(band.latestHi, chart.currency)}`
                    : money(band.latestHi, chart.currency)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PriceHistoryChart({
  cardId,
  maxHeight = null,
}: {
  cardId: string;
  /** Height to stay within — the card art's height, so the two columns end level. */
  maxHeight?: number | null;
}) {
  const [history, setHistory] = useState<CardPriceHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeService, setActiveService] = useState<string | null>(null);
  // 90 days to begin with: long enough to show a trend, short enough to show detail.
  const [range, setRange] = useState<number | null>(90);

  useEffect(() => {
    const controller = new AbortController();
    setHistory(null);
    setError(null);

    const show = (h: CardPriceHistory) => {
      if (controller.signal.aborted) return;
      setHistory(h);
      setActiveService((prev) =>
        prev && h.charts.some((c) => c.service === prev) ? prev : (h.charts[0]?.service ?? null),
      );
    };

    // One read, no capture. Every card in the catalogue is priced by the daily sync, so
    // there is nothing to fetch on demand any more — opening a card used to trigger an
    // outbound request because the old source could only price cards one at a time.
    // Ten years, so every range in the selector is served by this one read.
    fetchCardPriceHistory(cardId, 3650, controller.signal)
      .then(show)
      .catch((err) => {
        if (controller.signal.aborted) return;
        // A capture that fails still leaves whatever was already stored on screen.
        if (history) return;
        setError(err instanceof Error ? err.message : 'Could not load price history');
      });
    return () => controller.abort();
    // history is deliberately not a dependency: it is read only to decide whether a late
    // failure should replace a chart that is already drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  const chart = history?.charts.find((c) => c.service === activeService) ?? history?.charts[0] ?? null;

  // These three sit above the early returns because hooks must run in the same order on
  // every render, and below them the component may bail out before reaching this point.
  //
  // Trimming to the chosen window happens here rather than by refetching. The whole history
  // arrives in one read, so switching range is instant and costs nothing -- and the earliest
  // date is known, which is what lets a window longer than the data say so rather than look
  // broken.
  const earliest = useMemo(() => {
    let found: string | null = null;
    for (const c of history?.charts ?? []) {
      for (const sr of c.series) {
        const first = sr.points[0]?.date;
        if (first && (!found || first < found)) found = first;
      }
    }
    return found;
  }, [history]);

  const windowed = useMemo(() => {
    if (!chart) return null;
    if (range === null) return chart;
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - range);
    const from = cutoff.toISOString().slice(0, 10);
    return {
      ...chart,
      series: chart.series.map((sr) => ({ ...sr, points: sr.points.filter((pt) => pt.date >= from) }))
        .filter((sr) => sr.points.length > 0),
    };
  }, [chart, range]);

  if (error) return <p className="text-xs text-[var(--color-text-muted)]">{error}</p>;
  if (!history) return <p className="text-xs text-[var(--color-text-muted)]">Loading price history…</p>;
  if (!chart || !windowed || history.charts.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-muted)]">
        No prices recorded for this card yet.
      </p>
    );
  }

  const daysHeld = earliest
    ? Math.round((Date.now() - Date.parse(earliest + 'T00:00:00Z')) / 86400000)
    : 0;

  return (
    <div>
      {/* One tab per source, so each service's numbers are read on their own terms. */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)]">
        {history.charts.map((c) => (
          <button
            key={c.service}
            type="button"
            onClick={() => setActiveService(c.service)}
            className={`-mb-px border-b-2 px-2 py-1 text-xs transition ${
              c.service === chart.service
                ? 'border-[var(--color-accent)] font-medium text-[var(--color-text)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {c.label}
          </button>
        ))}
        {/* The currency sits with the active tab, never on the page: two marketplaces quote
            in different money and a figure read off the wrong one is wrong silently. */}
        <span className="ml-auto pr-1 text-[10px] text-[var(--color-text-muted)]">
          {chart.label} · {chart.currency}
        </span>
      </div>

      <div className="mt-2">
        <Chart key={`${chart.service}-${range ?? 'all'}`} chart={windowed} maxHeight={maxHeight} />
      </div>

      {/* Ranges below the plot, as a trading chart puts them. A window reaching further back
          than the data is not hidden or disabled -- it draws what exists and the note says
          from when, so a short line reads as a short history rather than a fault. */}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {RANGES.map((r) => {
          const active = r.days === range;
          const beyond = r.days !== null && daysHeld > 0 && r.days > daysHeld;
          return (
            <button
              key={r.label}
              type="button"
              onClick={() => setRange(r.days)}
              aria-pressed={active}
              title={beyond ? `Only ${daysHeld} days recorded so far` : undefined}
              className={`rounded px-1.5 py-0.5 text-[11px] tabular-nums transition ${
                active
                  ? 'bg-[var(--color-accent)] font-medium text-white'
                  : beyond
                    ? 'text-[var(--color-text-muted)] opacity-50 hover:opacity-80'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {r.label}
            </button>
          );
        })}
        {earliest && (
          <span className="ml-auto pr-1 text-[10px] text-[var(--color-text-muted)]">
            recorded since {earliest}
          </span>
        )}
      </div>
    </div>
  );
}
