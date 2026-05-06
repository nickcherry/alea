import { exchangePerpVolumeWeights } from "@alea/lib/exchangePrices/exchangePerpVolumeWeights";
import { exchangeSpotVolumeWeights } from "@alea/lib/exchangePrices/exchangeSpotVolumeWeights";
import { interpolateMidsAtTimestamps } from "@alea/lib/exchangePrices/interpolateMidsAtTimestamps";
import {
  aleaBrandMark,
  aleaChartTokens,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import type { ExchangeId, QuoteTick } from "@alea/types/exchanges";

type RenderPriceChartHtmlParams = {
  readonly ticks: readonly QuoteTick[];
  readonly tickCounts: Partial<Record<ExchangeId, number>>;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly exhaustive: boolean;
  /**
   * Relative hrefs (resolved by `copyDashboardAssets`) for the
   * stylesheets and scripts the rendered HTML should reference.
   */
  readonly assets: {
    readonly stylesheets: readonly string[];
    readonly scripts: readonly string[];
  };
};

/**
 * Renders a self-contained dark-themed HTML chart of mid-price BBO ticks
 * per exchange using uPlot. Two synced panels stacked vertically:
 *
 *   - Top panel: spot venues + (in exhaustive mode) spot VWAP +
 *     polymarket-chainlink (a Chainlink-derived spot oracle).
 *   - Bottom panel: perp/swap venues + (in exhaustive mode) perp VWAP.
 *
 * Each panel's y-axis auto-fits its own data, so there is no wasted space
 * between the two clusters (they typically sit ~$30 apart due to funding-
 * rate basis). Both panels share an x-cursor so hovering anywhere
 * highlights the same instant in both, and a single floating tooltip
 * lists every series across both panels.
 *
 * Every series is linearly interpolated onto a single 100ms grid so the
 * cursor finds every series' value at every x — no gaps from the slower
 * Chainlink feed.
 */
export function renderPriceChartHtml({
  ticks,
  startedAtMs,
  endedAtMs,
  exhaustive,
  assets,
}: RenderPriceChartHtmlParams): string {
  const grid = buildGrid({ startedAtMs, endedAtMs, binMs: gridBinMs });
  const ticksByExchange = groupTicksByExchange({ ticks });
  const panels = buildPanelData({ ticksByExchange, grid, exhaustive });
  const tickCountsByExchange = countTicksByExchange({ ticksByExchange });
  const tickCountBars = buildTickCountBars({ tickCountsByExchange });
  const totalTicks = Object.values(tickCountsByExchange).reduce(
    (acc, n) => acc + n,
    0,
  );

  const title = "Exchange Price Latency";
  const subtitle = formatSubtitle({
    startedAtMs,
    endedAtMs,
    exhaustive,
    totalTicks,
  });

  const priceChartPayload = {
    spotPanel: panels.spot,
    perpPanel: panels.perp,
    xs: panels.xs,
    tickCountsByLabel: tickCountsByExchange,
    tickCountBars,
    chartTokens: aleaChartTokens,
  };
  const priceChartPayloadJson = JSON.stringify(priceChartPayload).replace(
    /<\/(script)/gi,
    "<\\/$1",
  );

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alea · ${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.min.css" />
  <script src="https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.iife.min.js" charset="utf-8"></script>
  ${aleaDesignSystemHead({ stylesheets: assets.stylesheets })}
</head>
<body>
  <div class="alea-shell latency-shell">
    <header class="alea-header">
      <div class="alea-brand-row">${aleaBrandMark()}</div>
      <h1 class="alea-title">${escapeHtml(title)}</h1>
      <p class="alea-subtitle">${subtitle}</p>
    </header>
    <main class="alea-main">
      <section class="alea-card with-corners chart-card">
        <header class="chart-card-head">
          <div id="legend" class="alea-legend"></div>
        </header>
        <div class="panels">
          <div class="panel spot">
            <span class="panel-tag">Spot</span>
            <div id="chart-spot" class="uplot-host"></div>
          </div>
          <div class="panel perp">
            <span class="panel-tag">Perp</span>
            <div id="chart-perp" class="uplot-host"></div>
          </div>
          <div id="tooltip" class="alea-tooltip"></div>
        </div>
      </section>
      <section class="alea-card bars-card">
        <div class="alea-section-rule"><h2>Ticks captured per source</h2></div>
        <div id="bars" class="bars"></div>
      </section>
    </main>
  </div>
  <script id="price-chart-payload" type="application/json">${priceChartPayloadJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>
`;
}

const gridBinMs = 100;
const polymarketLineWidth = 3.25;
const defaultLineWidth = 1.4;
const uniformLineWidth = 1.6;
const exchangeLineOpacity = 0.45;
const consensusLineWidth = 2;

/**
 * Aggregate-line colors. On the dark theme, a marble/ivory spot VWAP and
 * an antique-gold perp VWAP read as ceremonial overlays — visually
 * distinct from any single venue color.
 */
const spotConsensusColor = "#e8dec4";
const perpConsensusColor = "#d7aa45";

/**
 * Per-venue stroke colors. Tuned for the dark Alea palette: each color
 * keeps its brand identity (Coinbase blue, Binance amber, etc.) but is
 * brightened where necessary so it stays readable on a deep felt-green
 * panel.
 */
const colorByExchange: Record<ExchangeId, string> = {
  "coinbase-spot": "#2a8bff",
  "coinbase-perp": "#5fa8ff",
  "binance-spot": "#f0b90b",
  "binance-perp": "#d99d2c",
  "bybit-spot": "#ff8533",
  "bybit-perp": "#ffa75e",
  "okx-spot": "#cbd5e1",
  "okx-swap": "#94a3b8",
  "bitstamp-spot": "#27d18e",
  "gemini-spot": "#34d2d4",
  "polymarket-chainlink": "#ff5470",
};

const shortLabelByExchange: Record<ExchangeId, string> = {
  "coinbase-spot": "coinbase",
  "coinbase-perp": "coinbase-perp",
  "binance-spot": "binance",
  "binance-perp": "binance-perp",
  "bybit-spot": "bybit",
  "bybit-perp": "bybit-perp",
  "okx-spot": "okx",
  "okx-swap": "okx-swap",
  "bitstamp-spot": "bitstamp",
  "gemini-spot": "gemini",
  "polymarket-chainlink": "polymarket",
};

const spotVenues: readonly ExchangeId[] = [
  "binance-spot",
  "bitstamp-spot",
  "bybit-spot",
  "coinbase-spot",
  "gemini-spot",
  "okx-spot",
];
const perpVenues: readonly ExchangeId[] = [
  "binance-perp",
  "coinbase-perp",
  "bybit-perp",
  "okx-swap",
];
const polymarketKey: ExchangeId = "polymarket-chainlink";

type SeriesMeta = {
  readonly label: string;
  readonly stroke: string;
  readonly width: number;
  readonly alpha: number;
  readonly dash: boolean;
  readonly priority: number;
};

type PanelData = {
  readonly meta: readonly SeriesMeta[];
  readonly ys: readonly (readonly (number | null)[])[];
};

type AllPanelsData = {
  readonly xs: readonly number[];
  readonly spot: PanelData;
  readonly perp: PanelData;
};

function buildGrid({
  startedAtMs,
  endedAtMs,
  binMs,
}: {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly binMs: number;
}): number[] {
  const aligned = Math.floor(startedAtMs / binMs) * binMs;
  const grid: number[] = [];
  for (let t = aligned; t <= endedAtMs; t += binMs) {
    grid.push(t);
  }
  return grid;
}

function groupTicksByExchange({
  ticks,
}: {
  readonly ticks: readonly QuoteTick[];
}): Map<ExchangeId, QuoteTick[]> {
  const out = new Map<ExchangeId, QuoteTick[]>();
  for (const tick of ticks) {
    const list = out.get(tick.exchange) ?? [];
    list.push(tick);
    out.set(tick.exchange, list);
  }
  return out;
}

function buildPanelData({
  ticksByExchange,
  grid,
  exhaustive,
}: {
  readonly ticksByExchange: ReadonlyMap<ExchangeId, readonly QuoteTick[]>;
  readonly grid: readonly number[];
  readonly exhaustive: boolean;
}): AllPanelsData {
  const xs = grid.map((ms) => ms / 1000);

  const interpolatedByExchange = new Map<ExchangeId, Array<number | null>>();
  for (const [exchange, ticks] of ticksByExchange) {
    interpolatedByExchange.set(
      exchange,
      interpolateMidsAtTimestamps({ ticks, timestampsMs: grid }),
    );
  }

  const venueWidth = exhaustive ? defaultLineWidth : uniformLineWidth;
  const venueAlpha = exhaustive ? exchangeLineOpacity : 1;

  const spotMeta: SeriesMeta[] = [];
  const spotYs: Array<readonly (number | null)[]> = [];
  for (const exchange of spotVenues) {
    if (!ticksByExchange.has(exchange)) {
      continue;
    }
    const interp = interpolatedByExchange.get(exchange);
    if (!interp) {
      continue;
    }
    spotMeta.push({
      label: shortLabelByExchange[exchange],
      stroke: colorByExchange[exchange],
      width: venueWidth,
      alpha: venueAlpha,
      dash: false,
      priority: 0,
    });
    spotYs.push(interp);
  }
  if (exhaustive) {
    spotMeta.push({
      label: "spot vwap",
      stroke: spotConsensusColor,
      width: consensusLineWidth,
      alpha: 1,
      dash: true,
      priority: 5,
    });
    spotYs.push(
      computeConsensusOnGrid({
        grid,
        interpolatedByExchange,
        weights: exchangeSpotVolumeWeights,
      }),
    );
  }
  if (ticksByExchange.has(polymarketKey)) {
    const interp = interpolatedByExchange.get(polymarketKey);
    if (interp) {
      // Polymarket is always emphasized — it's the focal series in both
      // default and exhaustive modes.
      spotMeta.push({
        label: shortLabelByExchange[polymarketKey],
        stroke: colorByExchange[polymarketKey],
        width: polymarketLineWidth,
        alpha: 1,
        dash: false,
        priority: 10,
      });
      spotYs.push(interp);
    }
  }

  const perpMeta: SeriesMeta[] = [];
  const perpYs: Array<readonly (number | null)[]> = [];
  for (const exchange of perpVenues) {
    if (!ticksByExchange.has(exchange)) {
      continue;
    }
    const interp = interpolatedByExchange.get(exchange);
    if (!interp) {
      continue;
    }
    perpMeta.push({
      label: shortLabelByExchange[exchange],
      stroke: colorByExchange[exchange],
      width: venueWidth,
      alpha: venueAlpha,
      dash: false,
      priority: 0,
    });
    perpYs.push(interp);
  }
  if (exhaustive) {
    perpMeta.push({
      label: "perp vwap",
      stroke: perpConsensusColor,
      width: consensusLineWidth,
      alpha: 1,
      dash: true,
      priority: 5,
    });
    perpYs.push(
      computeConsensusOnGrid({
        grid,
        interpolatedByExchange,
        weights: exchangePerpVolumeWeights,
      }),
    );
  }

  return {
    xs,
    spot: { meta: spotMeta, ys: spotYs },
    perp: { meta: perpMeta, ys: perpYs },
  };
}

function computeConsensusOnGrid({
  grid,
  interpolatedByExchange,
  weights,
}: {
  readonly grid: readonly number[];
  readonly interpolatedByExchange: ReadonlyMap<
    ExchangeId,
    ReadonlyArray<number | null>
  >;
  readonly weights: Partial<Record<ExchangeId, number>>;
}): Array<number | null> {
  const out: Array<number | null> = [];
  for (let i = 0; i < grid.length; i += 1) {
    let weightedSum = 0;
    let weightSum = 0;
    for (const [exchange, w] of Object.entries(weights) as [
      ExchangeId,
      number,
    ][]) {
      if (!w || w <= 0) {
        continue;
      }
      const series = interpolatedByExchange.get(exchange);
      const v = series?.[i];
      if (v == null) {
        continue;
      }
      weightedSum += w * v;
      weightSum += w;
    }
    out.push(weightSum > 0 ? weightedSum / weightSum : null);
  }
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSubtitle({
  startedAtMs,
  endedAtMs,
  exhaustive,
  totalTicks,
}: {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly exhaustive: boolean;
  readonly totalTicks: number;
}): string {
  const started = formatTimestamp(startedAtMs);
  const durationS = Math.max(1, Math.round((endedAtMs - startedAtMs) / 1000));
  const mode = exhaustive ? "exhaustive" : "default";
  const ticks = totalTicks.toLocaleString();
  return `captured ${escapeHtml(started)}<span class="sep">·</span>${durationS}s window<span class="sep">·</span>${ticks} ticks<span class="sep">·</span>${mode} mode`;
}

function formatTimestamp(ms: number): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} @ ${get("hour")}:${get("minute")} ET`;
}

function countTicksByExchange({
  ticksByExchange,
}: {
  readonly ticksByExchange: ReadonlyMap<ExchangeId, readonly QuoteTick[]>;
}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [exchange, list] of ticksByExchange) {
    out[shortLabelByExchange[exchange]] = list.length;
  }
  return out;
}

type TickCountBar = {
  readonly label: string;
  readonly count: number;
  readonly stroke: string;
};

function buildTickCountBars({
  tickCountsByExchange,
}: {
  readonly tickCountsByExchange: Record<string, number>;
}): TickCountBar[] {
  const labelToExchange = new Map<string, ExchangeId>();
  for (const [exchange, label] of Object.entries(shortLabelByExchange) as [
    ExchangeId,
    string,
  ][]) {
    labelToExchange.set(label, exchange);
  }
  return Object.entries(tickCountsByExchange)
    .map(([label, count]) => {
      const exchange = labelToExchange.get(label);
      const stroke = exchange ? colorByExchange[exchange] : "#94a3b8";
      return { label, count, stroke };
    })
    .sort((a, b) => b.count - a.count);
}
