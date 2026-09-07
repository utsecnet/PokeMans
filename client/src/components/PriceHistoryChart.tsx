import { useEffect, useMemo, useRef, useState } from 'react';
import { captureCardPrices, fetchCardPriceHistory } from '../lib/api';
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

const DISPLAY_NAMES: Record<string, string> = {
  pokemonpricetracker: 'PokemonPriceTracker',
  tcgdex: 'TCGdex',
  tcgplayer: 'TCGplayer',
  cardmarket: 'Cardmarket',
};
const displayName = (id: string) => DISPLAY_NAMES[id] ?? id;

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
      label: showMarketplace ? `${printing} · ${displayName(group[0].marketplace)}` : printing,
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
  const path = (pts: { date: string; v: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date)},${y(p.v)}`).join(' ');

  return (
    <div ref={wrapRef}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        className="block"
        role="img"
        aria-label={`Price history from ${displayName(chart.service)} in ${chart.currency}`}
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
              {band.points.map((p) => (
                <g key={p.date}>
                  <circle cx={x(p.date)} cy={y(p.hi)} r={singlePoint ? 3 : 1.8} fill={color}>
                    <title>
                      {`${band.label}\n${p.date}\n${
                        p.hi === p.lo
                          ? money(p.hi, chart.currency)
                          : `best ${money(p.hi, chart.currency)} · worst ${money(p.lo, chart.currency)}`
                      }`}
                    </title>
                  </circle>
                  {isBand && (
                    <circle cx={x(p.date)} cy={y(p.lo)} r={singlePoint ? 3 : 1.8} fill={color} opacity="0.75" />
                  )}
                </g>
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

    // Stored history paints first so the panel isn't blank while the network call runs, then a
    // capture fills in today's prices for any card — including ones outside the collection,
    // which would otherwise have nothing to show. The server skips the fetch when it already
    // holds today's figures, so re-opening a card costs a database read.
    fetchCardPriceHistory(cardId, controller.signal)
      .then((h) => {
        show(h);
        return captureCardPrices(cardId, controller.signal);
      })
      .then((res) => (res.rows > 0 ? fetchCardPriceHistory(cardId, controller.signal).then(show) : undefined))
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

  if (error) return <p className="text-xs text-[var(--color-text-muted)]">{error}</p>;
  if (!history) return <p className="text-xs text-[var(--color-text-muted)]">Loading price history…</p>;
  if (history.charts.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-muted)]">
        No history recorded yet. Prices are captured daily for cards in your collection.
      </p>
    );
  }

  const chart = history.charts.find((c) => c.service === activeService) ?? history.charts[0];

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
            {displayName(c.service)}
          </button>
        ))}
        <span className="ml-auto pr-1 text-[10px] text-[var(--color-text-muted)]">{chart.currency}</span>
      </div>

      {history.ratesUnavailable && (
        <p className="mt-1.5 text-[10px] text-[var(--color-text-muted)]">
          Some values were left out — no exchange rate was available.
        </p>
      )}

      <div className="mt-2">
        <Chart key={chart.service} chart={chart} maxHeight={maxHeight} />
      </div>
    </div>
  );
}
