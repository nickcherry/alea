import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";

import {
  CANDIDATE_BACKTEST_END_EXCLUSIVE_MS,
  CANDIDATE_BACKTEST_START_MS,
} from "@alea/constants/backtest";
import {
  TRADE_DECISION_DEFAULT_MARKETS,
  tradeDecisionFireTimeMs,
  tradeDecisionHydrateBars,
  type TradeDecisionMarket,
  type TradeDecisionPeriod,
} from "@alea/constants/tradeDecision";
import {
  buildDefaultMarketChartIndicators,
  type MarketChartIndicators,
  type MarketChartPriceActionMarker,
  type MarketChartRsiDivergenceMarker,
} from "@alea/lib/candles/chart/buildMarketChartIndicators";
import {
  launchMarketChartBrowser,
  renderMarketChartImage,
} from "@alea/lib/candles/chart/renderMarketChartImage";
import { timeframeMs } from "@alea/lib/candles/timeframeMs";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineFlagOption } from "@alea/lib/cli/defineFlagOption";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import type { DatabaseClient } from "@alea/lib/db/types";
import { registeredCandidatesForMarket } from "@alea/lib/filters/registry";
import {
  type RsiDivergenceConfig,
  rsiDivergenceFilter,
} from "@alea/lib/filters/rsiDivergence";
import {
  findRecentRsiDivergenceMatch,
  type RsiDivergenceMatch,
} from "@alea/lib/filters/rsiDivergenceCore";
import {
  evaluateRsiDivergenceInvalidation,
  type RsiDivergenceInvalidationResult,
} from "@alea/lib/filters/rsiDivergenceInvalidation";
import type { FilterCandidate } from "@alea/lib/filters/types";
import { alignMarketSeries } from "@alea/lib/marketSeries/align";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import type { Asset } from "@alea/types/assets";
import type { Candle } from "@alea/types/candles";
import pc from "picocolors";
import type { Browser } from "playwright-core";
import { z } from "zod";

const oneMinuteMs = 60_000;
const defaultWidth = 1600;
const defaultHeight = 900;
const filterChoices = ["rsi_divergence"] as const;
const sampleKindChoices = ["fired", "invalidated", "mixed"] as const;

type SampleKind = (typeof sampleKindChoices)[number];

type DecisionTuple = readonly [number, "up" | "down", 0 | 1];

type VisualizationTrade = {
  readonly targetTsMs: number;
  readonly prediction: "up" | "down";
  readonly won: boolean;
};

type VisualizationEvent = {
  readonly kind: "fired" | "invalidated";
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly candidate: FilterCandidate<RsiDivergenceConfig>;
  readonly targetTsMs: number;
  readonly prediction?: "up" | "down";
  readonly won?: boolean;
  readonly trades: readonly VisualizationTrade[];
};

type EventDetail = {
  readonly match: Extract<RsiDivergenceMatch, { readonly matched: true }>;
  readonly invalidation: RsiDivergenceInvalidationResult;
};

type RenderedVisualization = {
  readonly path: string;
  readonly kind: VisualizationEvent["kind"];
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly target: string;
  readonly prediction: "up" | "down" | null;
  readonly won: boolean | null;
  readonly tradeCount: number;
  readonly winCount: number;
  readonly lossCount: number;
  readonly divergenceKind: string;
  readonly barsAgo: number;
  readonly invalidation: string | null;
};

export const filtersVisualizeCommand = defineCommand({
  name: "filters:visualize",
  summary: "Render filter decision chart examples",
  description:
    "Samples persisted or recomputed filter decisions and renders candlestick PNGs with filter-specific markers. The first supported filter is RSI divergence: fired charts are grouped by divergence occurrence and mark the pivot, pivot-confirmation candle, and every trade result caused by that occurrence.",
  options: [
    defineValueOption({
      key: "filter",
      long: "--filter",
      valueName: "FILTER",
      choices: filterChoices,
      schema: z.enum(filterChoices).default("rsi_divergence"),
    }),
    defineValueOption({
      key: "sampleKind",
      long: "--sample-kind",
      valueName: "KIND",
      choices: sampleKindChoices,
      schema: z.enum(sampleKindChoices).default("fired"),
    }),
    defineValueOption({
      key: "candidateId",
      long: "--candidate-id",
      valueName: "ID",
      schema: z
        .string()
        .optional()
        .describe(
          "Specific candidate id to visualize. Defaults to the first registered candidate for the filter.",
        ),
    }),
    defineValueOption({
      key: "samples",
      long: "--samples",
      valueName: "N",
      schema: z.coerce
        .number()
        .int()
        .min(1)
        .max(200)
        .default(20)
        .describe("Maximum number of chart examples to render."),
    }),
    defineValueOption({
      key: "perMarket",
      long: "--per-market",
      valueName: "N",
      schema: z.coerce
        .number()
        .int()
        .min(1)
        .max(50)
        .default(5)
        .describe(
          "Maximum examples sampled from each asset/timeframe market.",
        ),
    }),
    defineValueOption({
      key: "assets",
      long: "--assets",
      valueName: "CSV",
      schema: z
        .string()
        .optional()
        .describe("Comma-separated asset filter, e.g. btc,eth."),
    }),
    defineValueOption({
      key: "periods",
      long: "--periods",
      valueName: "CSV",
      schema: z
        .string()
        .optional()
        .describe(
          "Comma-separated period filter. Defaults to the active 1h trading market.",
        ),
    }),
    defineValueOption({
      key: "start",
      long: "--start",
      valueName: "ISO",
      schema: optionalDateSchema("Sample window start. Defaults to the backtest start."),
    }),
    defineValueOption({
      key: "end",
      long: "--end",
      valueName: "ISO",
      schema: optionalDateSchema("Sample window end. Defaults to now."),
    }),
    defineValueOption({
      key: "beforeBars",
      long: "--before-bars",
      valueName: "N",
      schema: z.coerce
        .number()
        .int()
        .min(20)
        .max(500)
        .default(80)
        .describe("Candles to show before the first trade target candle."),
    }),
    defineValueOption({
      key: "afterBars",
      long: "--after-bars",
      valueName: "N",
      schema: z.coerce
        .number()
        .int()
        .min(0)
        .max(200)
        .default(30)
        .describe("Candles to show after the target candle."),
    }),
    defineValueOption({
      key: "outDir",
      long: "--out-dir",
      valueName: "PATH",
      schema: z
        .string()
        .optional()
        .describe(
          "Output directory. Defaults to tmp/charts/filter-visualizations/<timestamp>/.",
        ),
    }),
    defineValueOption({
      key: "width",
      long: "--width",
      valueName: "PX",
      schema: z.coerce.number().int().min(640).max(3840).default(defaultWidth),
    }),
    defineValueOption({
      key: "height",
      long: "--height",
      valueName: "PX",
      schema: z.coerce.number().int().min(420).max(2160).default(defaultHeight),
    }),
    defineValueOption({
      key: "browserPath",
      long: "--browser-path",
      valueName: "PATH",
      schema: z
        .string()
        .optional()
        .describe(
          "Optional Chrome/Chromium executable path. Also accepts ALEA_CHART_BROWSER_PATH.",
        ),
    }),
    defineFlagOption({
      key: "showIndicators",
      long: "--show-indicators",
      schema: z
        .boolean()
        .default(false)
        .describe(
          "Show chart context overlays such as SMA lines. Filter markers are always shown.",
        ),
    }),
  ],
  examples: [
    "bun alea filters:visualize",
    "bun alea filters:visualize --samples 20 --per-market 5",
    "bun alea filters:visualize --candidate-id rsi_divergence@v6:...",
    "bun alea filters:visualize --sample-kind invalidated --assets btc,eth --periods 1h",
    "bun alea filters:visualize --show-indicators",
    "bun alea filters:visualize --before-bars 120 --after-bars 40 --out-dir tmp/charts/rsi-review",
  ],
  output:
    "Prints each rendered PNG path and writes a summary.json next to the images.",
  sideEffects:
    "Reads local Postgres candles and candidate backtest data, then writes PNG chart artifacts under tmp/charts/.",
  async run({ io, options }) {
    const db = createDatabase();
    const outDir = resolvePath(
      options.outDir ??
        `tmp/charts/filter-visualizations/${timestampForFilename(new Date())}`,
    );
    const startMs =
      options.start?.getTime() ?? CANDIDATE_BACKTEST_START_MS;
    const endMs =
      options.end?.getTime() ??
      CANDIDATE_BACKTEST_END_EXCLUSIVE_MS ??
      Date.now();
    const markets = selectedMarkets({
      assetsCsv: options.assets,
      periodsCsv: options.periods,
    });

    let browser: Browser | null = null;
    try {
      await mkdir(outDir, { recursive: true });
      io.writeStdout(
        `${pc.bold("alea filters:visualize")} ${pc.cyan(options.filter)} ${pc.dim(`${options.sampleKind} samples=${options.samples} perMarket=${options.perMarket}`)}\n`,
      );

      const events = await sampleVisualizationEvents({
        db,
        markets,
        candidateId: options.candidateId,
        sampleKind: options.sampleKind,
        samples: options.samples,
        perMarket: options.perMarket,
        startMs,
        endMs,
      });

      if (events.length === 0) {
        io.writeStdout(`${pc.yellow("no matching events found")}\n`);
        return;
      }

      const rendered: RenderedVisualization[] = [];
      browser = await launchMarketChartBrowser({
        browserPath: options.browserPath,
      });
      let index = 0;
      for (const event of events) {
        index += 1;
        const result = await renderVisualizationEvent({
          db,
          event,
          index,
          outDir,
          beforeBars: options.beforeBars,
          afterBars: options.afterBars,
          width: options.width,
          height: options.height,
          browserPath: options.browserPath,
          browser,
          showIndicators: options.showIndicators,
        });
        if (result === null) {
          continue;
        }
        rendered.push(result);
        io.writeStdout(
          `${pc.green("wrote")} ${pc.dim(result.path)}  ${result.period}/${result.asset} ${result.kind} ${tradeSummary(result)} ${pc.dim(result.target)}\n`,
        );
      }

      const summaryPath = join(outDir, "summary.json");
      await writeFile(
        summaryPath,
        `${JSON.stringify({ generatedAt: new Date().toISOString(), rendered }, null, 2)}\n`,
      );
      io.writeStdout(`${pc.green("summary")} ${pc.dim(summaryPath)}\n`);
    } finally {
      await browser?.close();
      await destroyDatabase(db);
    }
  },
});

async function sampleVisualizationEvents({
  db,
  markets,
  candidateId,
  sampleKind,
  samples,
  perMarket,
  startMs,
  endMs,
}: {
  readonly db: DatabaseClient;
  readonly markets: readonly TradeDecisionMarket[];
  readonly candidateId: string | undefined;
  readonly sampleKind: SampleKind;
  readonly samples: number;
  readonly perMarket: number;
  readonly startMs: number;
  readonly endMs: number;
}): Promise<readonly VisualizationEvent[]> {
  const byMarket = await Promise.all(
    markets.map(async (market) => {
      const fired =
        sampleKind === "fired" || sampleKind === "mixed"
          ? await loadFiredEventsForMarket({
              db,
              market,
              candidateId,
              startMs,
              endMs,
              perMarket,
            })
          : [];
      const invalidated =
        sampleKind === "invalidated" || sampleKind === "mixed"
          ? await loadInvalidatedEventsForMarket({
              db,
              market,
              candidateId,
              startMs,
              endMs,
              perMarket,
            })
          : [];
      return takeEvenly({
        items:
          sampleKind === "mixed" ? interleave([fired, invalidated]) : [...fired, ...invalidated],
        count: perMarket,
      });
    }),
  );
  return takeRoundRobin({ groups: byMarket, count: samples });
}

async function loadFiredEventsForMarket({
  db,
  market,
  candidateId,
  startMs,
  endMs,
  perMarket,
}: {
  readonly db: DatabaseClient;
  readonly market: TradeDecisionMarket;
  readonly candidateId: string | undefined;
  readonly startMs: number;
  readonly endMs: number;
  readonly perMarket: number;
}): Promise<readonly VisualizationEvent[]> {
  const candidate = rsiCandidateForMarket({ ...market, candidateId });
  const rows = await db
    .selectFrom("candidate_backtest_quarter_results")
    .select(["decisions"])
    .where("candidate_id", "=", candidate.id)
    .where("asset", "=", market.asset)
    .where("timeframe", "=", market.period)
    .where("window_end_ms", ">", String(startMs))
    .where("window_start_ms", "<", String(endMs))
    .orderBy("quarter_start_ms", "asc")
    .execute();
  const decisions = rows
    .flatMap((row) => decisionsFromJson(row.decisions))
    .filter(([targetTsMs]) => targetTsMs >= startMs && targetTsMs < endMs);
  if (decisions.length === 0) {
    return [];
  }
  const periodMs = timeframeMs({ timeframe: market.period });
  const hydrateBars = tradeDecisionHydrateBars({ period: market.period });
  const [periodBars, minuteBars] = await Promise.all([
    loadPythBars({
      db,
      asset: market.asset,
      timeframe: market.period,
      startMs: Math.max(0, startMs - periodMs * (hydrateBars + 2)),
      endMs,
    }),
    loadPythBars({
      db,
      asset: market.asset,
      timeframe: "1m",
      startMs: Math.max(0, startMs - periodMs),
      endMs,
    }),
  ]);
  const byOccurrence = new Map<
    string,
    {
      readonly key: string;
      readonly targetTsMs: number;
      readonly prediction: "up" | "down";
      readonly won: boolean;
      readonly trades: VisualizationTrade[];
    }
  >();
  for (const [targetTsMs, prediction, wonValue] of decisions) {
    const detail = rsiDetailForTarget({
      candidate,
      period: market.period,
      periodBars,
      minuteBars,
      targetTsMs,
    });
    if (detail === null) {
      continue;
    }
    const occurrenceKey = rsiOccurrenceKey(detail.match);
    if (occurrenceKey === null) {
      continue;
    }
    const won = wonValue === 1;
    const existing = byOccurrence.get(occurrenceKey);
    if (existing === undefined) {
      byOccurrence.set(occurrenceKey, {
        key: occurrenceKey,
        targetTsMs,
        prediction,
        won,
        trades: [{ targetTsMs, prediction, won }],
      });
      continue;
    }
    existing.trades.push({ targetTsMs, prediction, won });
  }
  const events = [...byOccurrence.values()]
    .sort((a, b) => a.targetTsMs - b.targetTsMs)
    .map((occurrence) => ({
      kind: "fired" as const,
      asset: market.asset,
      period: market.period,
      candidate,
      targetTsMs: occurrence.targetTsMs,
      prediction: occurrence.prediction,
      won: occurrence.won,
      trades: occurrence.trades.sort((a, b) => a.targetTsMs - b.targetTsMs),
    }));
  return takeEvenly({ items: events, count: perMarket });
}

async function loadInvalidatedEventsForMarket({
  db,
  market,
  candidateId,
  startMs,
  endMs,
  perMarket,
}: {
  readonly db: DatabaseClient;
  readonly market: TradeDecisionMarket;
  readonly candidateId: string | undefined;
  readonly startMs: number;
  readonly endMs: number;
  readonly perMarket: number;
}): Promise<readonly VisualizationEvent[]> {
  const candidate = rsiCandidateForMarket({ ...market, candidateId });
  const periodMs = timeframeMs({ timeframe: market.period });
  const hydrateBars = tradeDecisionHydrateBars({ period: market.period });
  const [periodBars, minuteBars] = await Promise.all([
    loadPythBars({
      db,
      asset: market.asset,
      timeframe: market.period,
      startMs: Math.max(0, startMs - periodMs * (hydrateBars + 2)),
      endMs,
    }),
    loadPythBars({
      db,
      asset: market.asset,
      timeframe: "1m",
      startMs: Math.max(0, startMs - periodMs),
      endMs,
    }),
  ]);
  const targetBars = periodBars.filter(
    (bar) => bar.openTimeMs >= startMs && bar.openTimeMs < endMs,
  );
  const events: VisualizationEvent[] = [];
  for (const targetBar of targetBars) {
    const detail = rsiDetailForTarget({
      candidate,
      period: market.period,
      periodBars,
      minuteBars,
      targetTsMs: targetBar.openTimeMs,
    });
    if (detail?.invalidation.invalidated === true) {
      events.push({
        kind: "invalidated",
        asset: market.asset,
        period: market.period,
        candidate,
        targetTsMs: targetBar.openTimeMs,
        trades: [],
      });
    }
  }
  return takeEvenly({ items: events, count: perMarket });
}

async function renderVisualizationEvent({
  db,
  event,
  index,
  outDir,
  beforeBars,
  afterBars,
  width,
  height,
  browserPath,
  browser,
  showIndicators,
}: {
  readonly db: DatabaseClient;
  readonly event: VisualizationEvent;
  readonly index: number;
  readonly outDir: string;
  readonly beforeBars: number;
  readonly afterBars: number;
  readonly width: number;
  readonly height: number;
  readonly browserPath?: string;
  readonly browser: Browser;
  readonly showIndicators: boolean;
}): Promise<RenderedVisualization | null> {
  const periodMs = timeframeMs({ timeframe: event.period });
  const lastTradeTargetTsMs = Math.max(
    event.targetTsMs,
    ...event.trades.map((trade) => trade.targetTsMs),
  );
  const chartStartMs = Math.max(0, event.targetTsMs - beforeBars * periodMs);
  const chartEndMs = lastTradeTargetTsMs + (afterBars + 1) * periodMs;
  const [chartCandles, periodBars, minuteBars] = await Promise.all([
    loadPythCandles({
      db,
      asset: event.asset,
      timeframe: event.period,
      startMs: chartStartMs,
      endMs: chartEndMs,
    }),
    loadPythBars({
      db,
      asset: event.asset,
      timeframe: event.period,
      startMs: Math.max(
        0,
        event.targetTsMs -
          periodMs * (tradeDecisionHydrateBars({ period: event.period }) + 2),
      ),
      endMs: event.targetTsMs,
    }),
    loadPythBars({
      db,
      asset: event.asset,
      timeframe: "1m",
      startMs: Math.max(0, event.targetTsMs - periodMs),
      endMs: event.targetTsMs,
    }),
  ]);
  if (chartCandles.length === 0) {
    return null;
  }
  const detail = rsiDetailForTarget({
    candidate: event.candidate,
    period: event.period,
    periodBars,
    minuteBars,
    targetTsMs: event.targetTsMs,
  });
  if (detail === null) {
    return null;
  }

  const outPath = join(
    outDir,
    `${String(index).padStart(2, "0")}-${event.asset}-${event.period}-${event.kind}-${event.targetTsMs}.png`,
  );
  const indicators = visualizationIndicators({
    candles: chartCandles,
    event,
    detail,
    showContextIndicators: showIndicators,
  });
  await renderMarketChartImage({
    candles: chartCandles,
    asset: event.asset,
    source: "pyth",
    product: "spot",
    timeframe: event.period,
    outPath,
    width,
    height,
    browserPath,
    browser,
    indicators,
  });

  return {
    path: outPath,
    kind: event.kind,
    asset: event.asset,
    period: event.period,
    target: new Date(event.targetTsMs).toISOString(),
    prediction: event.prediction ?? null,
    won: event.won ?? null,
    tradeCount: event.trades.length,
    winCount: event.trades.filter((trade) => trade.won).length,
    lossCount: event.trades.filter((trade) => !trade.won).length,
    divergenceKind: detail.match.signal.kind,
    barsAgo: detail.match.barsAgo,
    invalidation:
      detail.invalidation.invalidated === true
        ? detail.invalidation.reason ?? "invalidated"
        : null,
  };
}

function rsiDetailForTarget({
  candidate,
  period,
  periodBars,
  minuteBars,
  targetTsMs,
}: {
  readonly candidate: FilterCandidate<RsiDivergenceConfig>;
  readonly period: TradeDecisionPeriod;
  readonly periodBars: readonly MarketBar[];
  readonly minuteBars: readonly MarketBar[];
  readonly targetTsMs: number;
}): EventDetail | null {
  const hydrateBars = tradeDecisionHydrateBars({ period });
  const activeOpenTimeMs = targetTsMs;
  const decisionTsMs = tradeDecisionFireTimeMs({ period, targetTsMs });
  const closedEndIndex = lowerBoundOpenTime({
    bars: periodBars,
    openTimeMs: activeOpenTimeMs,
  });
  const history = periodBars.slice(
    Math.max(0, closedEndIndex - (hydrateBars - 1)),
    closedEndIndex,
  );
  const syntheticBar = synthesizePartialBar({
    minuteBars,
    activeOpenTimeMs,
    decisionTsMs,
  });
  if (history.length === 0 || syntheticBar === null) {
    return null;
  }
  const match = findRecentRsiDivergenceMatch({
    series: alignMarketSeries({
      pyth: [...history, syntheticBar],
      coinbase: [],
    }),
    config: candidate.config,
  });
  if (!match.matched) {
    return null;
  }
  return {
    match,
    invalidation: rsiInvalidationForMatch({
      match,
      config: candidate.config,
    }),
  };
}

function rsiOccurrenceKey(
  match: Extract<RsiDivergenceMatch, { readonly matched: true }>,
): string | null {
  const pivotBar = match.bars[match.signal.pivotIndex];
  const previousPivotBar = match.bars[match.signal.previousPivotIndex];
  const confirmBar = match.bars[match.signal.confirmedIndex];
  if (
    pivotBar === undefined ||
    previousPivotBar === undefined ||
    confirmBar === undefined
  ) {
    return null;
  }
  return [
    match.signal.kind,
    previousPivotBar.openTimeMs,
    pivotBar.openTimeMs,
    confirmBar.openTimeMs,
  ].join(":");
}

function visualizationIndicators({
  candles,
  event,
  detail,
  showContextIndicators,
}: {
  readonly candles: readonly Candle[];
  readonly event: VisualizationEvent;
  readonly detail: EventDetail;
  readonly showContextIndicators: boolean;
}): MarketChartIndicators {
  const defaults = showContextIndicators
    ? buildDefaultMarketChartIndicators({ candles })
    : null;
  const match = detail.match;
  const bullish = match.decision === "up";
  const pivotBar = match.bars[match.signal.pivotIndex];
  const confirmBar = match.bars[match.signal.confirmedIndex];
  const decisionBar = match.bars[match.lastIndex];
  const divergenceMarkers: MarketChartRsiDivergenceMarker[] = [];
  const actionMarkers: MarketChartPriceActionMarker[] = [];

  if (pivotBar !== undefined) {
    divergenceMarkers.push({
      time: Math.floor(pivotBar.openTimeMs / 1000),
      kind: match.signal.kind,
      text: divergenceLabel(match.signal.kind),
      color: bullish ? "#20c997" : "#ff6b6b",
      position: "belowBar",
      shape: bullish ? "arrowUp" : "arrowDown",
    });
  }
  if (confirmBar !== undefined) {
    actionMarkers.push({
      time: Math.floor(confirmBar.openTimeMs / 1000),
      kind: "rsi_divergence_confirmation",
      text: "pivot confirmed",
      color: "#4dabf7",
      position: "belowBar",
      shape: "square",
    });
  }
  if (event.trades.length === 0 && decisionBar !== undefined) {
    actionMarkers.push({
      time: Math.floor(decisionBar.openTimeMs / 1000),
      kind: "filter_decision",
      text:
        event.kind === "invalidated"
          ? "neutral"
          : `decide ${event.prediction ?? match.decision}`,
      color: event.kind === "invalidated" ? "#ff922b" : "#ffd43b",
      position: "belowBar",
      shape: "circle",
    });
  }
  if (event.trades.length > 0) {
    event.trades.forEach((trade, index) => {
      actionMarkers.push({
        time: Math.floor(trade.targetTsMs / 1000),
        kind: "trade_result",
        text: `trade ${index + 1} ${trade.prediction.toUpperCase()} ${trade.won ? "win" : "loss"}`,
        color: trade.won ? "#2f9e44" : "#e03131",
        position: "belowBar",
        shape: "square",
      });
    });
  } else {
    actionMarkers.push({
      time: Math.floor(event.targetTsMs / 1000),
      kind: "target_candle",
      text:
        event.won === undefined
          ? "target"
          : event.won
            ? "target win"
            : "target loss",
      color: event.won === undefined ? "#ced4da" : event.won ? "#2f9e44" : "#e03131",
      position: "belowBar",
      shape: "square",
    });
  }

  if (detail.invalidation.invalidated === true) {
    const invalidationOpenTimeMs = Number(
      detail.invalidation.metadata?.["invalidationOpenTimeMs"],
    );
    if (Number.isFinite(invalidationOpenTimeMs)) {
      const invalidationKind = detail.invalidation.metadata?.["invalidation"];
      actionMarkers.push({
        time: Math.floor(invalidationOpenTimeMs / 1000),
        kind:
          typeof invalidationKind === "string"
            ? invalidationKind
            : "invalidation",
        text: invalidationLabel(detail.invalidation),
        color: "#ff922b",
        position: "belowBar",
        shape: "circle",
      });
    }
  }

  return {
    priceLines: defaults?.priceLines ?? [],
    rsiDivergenceMarkers: divergenceMarkers,
    priceActionMarkers: actionMarkers,
    legendItems: [
      ...(showContextIndicators ? [{ label: "SMA", color: "#f2c94c" }] : []),
      { label: "RSI divergence pivot", color: "#20c997" },
      { label: "Pivot confirmed", color: "#4dabf7" },
      { label: "Decision", color: "#ffd43b" },
      { label: "Invalidation", color: "#ff922b" },
      { label: "Trade result", color: "#ced4da" },
    ],
  };
}

function rsiInvalidationForMatch({
  match,
  config,
}: {
  readonly match: Extract<RsiDivergenceMatch, { readonly matched: true }>;
  readonly config: RsiDivergenceConfig;
}): RsiDivergenceInvalidationResult {
  return evaluateRsiDivergenceInvalidation({ match, config });
}

async function loadPythCandles({
  db,
  asset,
  timeframe,
  startMs,
  endMs,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly timeframe: TradeDecisionPeriod;
  readonly startMs: number;
  readonly endMs: number;
}): Promise<readonly Candle[]> {
  const rows = await db
    .selectFrom("candles")
    .select(["timestamp", "open", "high", "low", "close", "volume"])
    .where("source", "=", "pyth")
    .where("product", "=", "spot")
    .where("asset", "=", asset)
    .where("timeframe", "=", timeframe)
    .where("timestamp", ">=", new Date(startMs))
    .where("timestamp", "<", new Date(endMs))
    .orderBy("timestamp", "asc")
    .execute();
  return rows.map((row) => ({
    source: "pyth",
    asset,
    product: "spot",
    timeframe,
    timestamp: row.timestamp,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  }));
}

async function loadPythBars({
  db,
  asset,
  timeframe,
  startMs,
  endMs,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly timeframe: "1m" | TradeDecisionPeriod;
  readonly startMs: number;
  readonly endMs: number;
}): Promise<readonly MarketBar[]> {
  const rows = await db
    .selectFrom("candles")
    .select(["timestamp", "open", "high", "low", "close", "volume"])
    .where("source", "=", "pyth")
    .where("product", "=", "spot")
    .where("asset", "=", asset)
    .where("timeframe", "=", timeframe)
    .where("timestamp", ">=", new Date(startMs))
    .where("timestamp", "<", new Date(endMs))
    .orderBy("timestamp", "asc")
    .execute();
  return rows.map((row) => ({
    openTimeMs: row.timestamp.getTime(),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  }));
}

function synthesizePartialBar({
  minuteBars,
  activeOpenTimeMs,
  decisionTsMs,
}: {
  readonly minuteBars: readonly MarketBar[];
  readonly activeOpenTimeMs: number;
  readonly decisionTsMs: number;
}): MarketBar | null {
  const start = lowerBoundOpenTime({
    bars: minuteBars,
    openTimeMs: activeOpenTimeMs,
  });
  const usable: MarketBar[] = [];
  for (let i = start; i < minuteBars.length; i += 1) {
    const bar = minuteBars[i]!;
    if (bar.openTimeMs < activeOpenTimeMs) {
      continue;
    }
    if (bar.openTimeMs + oneMinuteMs > decisionTsMs) {
      break;
    }
    usable.push(bar);
  }
  if (usable.length === 0) {
    return null;
  }
  return {
    openTimeMs: activeOpenTimeMs,
    open: usable[0]!.open,
    high: Math.max(...usable.map((bar) => bar.high)),
    low: Math.min(...usable.map((bar) => bar.low)),
    close: usable.at(-1)!.close,
    volume: usable.reduce((sum, bar) => sum + bar.volume, 0),
  };
}

function lowerBoundOpenTime({
  bars,
  openTimeMs,
}: {
  readonly bars: readonly MarketBar[];
  readonly openTimeMs: number;
}): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (bars[mid]!.openTimeMs < openTimeMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function rsiCandidateForMarket({
  asset,
  period,
  candidateId,
}: TradeDecisionMarket & {
  readonly candidateId?: string | undefined;
}): FilterCandidate<RsiDivergenceConfig> {
  const candidate = registeredCandidatesForMarket({ asset, period }).find(
    (item) =>
      item.filterId === rsiDivergenceFilter.id &&
      (candidateId === undefined || item.id === candidateId),
  );
  if (candidate === undefined) {
    const suffix =
      candidateId === undefined ? "" : ` with candidate id ${candidateId}`;
    throw new Error(
      `no RSI divergence candidate registered for ${period}/${asset}${suffix}`,
    );
  }
  return candidate as FilterCandidate<RsiDivergenceConfig>;
}

function selectedMarkets({
  assetsCsv,
  periodsCsv,
}: {
  readonly assetsCsv: string | undefined;
  readonly periodsCsv: string | undefined;
}): readonly TradeDecisionMarket[] {
  const assets = parseCsvSet({ value: assetsCsv });
  const periods = parseCsvSet({ value: periodsCsv });
  return TRADE_DECISION_DEFAULT_MARKETS.filter(
    (market) =>
      (assets === undefined || assets.has(market.asset)) &&
      (periods === undefined || periods.has(market.period)),
  );
}

function parseCsvSet({
  value,
}: {
  readonly value: string | undefined;
}): ReadonlySet<string> | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return new Set(
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0),
  );
}

function decisionsFromJson(value: unknown): readonly DecisionTuple[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!Array.isArray(item) || item.length !== 3) {
      return [];
    }
    const [targetTsMs, prediction, won] = item;
    if (
      typeof targetTsMs !== "number" ||
      (prediction !== "up" && prediction !== "down") ||
      (won !== 0 && won !== 1)
    ) {
      return [];
    }
    return [[targetTsMs, prediction, won] as const];
  });
}

function tradeSummary(result: RenderedVisualization): string {
  if (result.tradeCount > 0) {
    return `trades=${result.tradeCount.toLocaleString()} ${result.winCount.toLocaleString()}W/${result.lossCount.toLocaleString()}L`;
  }
  return `${result.prediction ?? "neutral"} ${
    result.won === null ? "" : result.won ? "win" : "loss"
  }`.trim();
}

function takeEvenly<T>({
  items,
  count,
}: {
  readonly items: readonly T[];
  readonly count: number;
}): readonly T[] {
  if (items.length <= count) {
    return items;
  }
  if (count === 1) {
    return [items[Math.floor(items.length / 2)]!];
  }
  const selected: T[] = [];
  const maxIndex = items.length - 1;
  for (let i = 0; i < count; i += 1) {
    selected.push(items[Math.round((i * maxIndex) / (count - 1))]!);
  }
  return selected;
}

function takeRoundRobin<T>({
  groups,
  count,
}: {
  readonly groups: readonly (readonly T[])[];
  readonly count: number;
}): readonly T[] {
  const out: T[] = [];
  const maxLength = Math.max(0, ...groups.map((group) => group.length));
  for (let i = 0; i < maxLength && out.length < count; i += 1) {
    for (const group of groups) {
      const item = group[i];
      if (item !== undefined) {
        out.push(item);
        if (out.length >= count) {
          break;
        }
      }
    }
  }
  return out;
}

function interleave<T>(groups: readonly (readonly T[])[]): readonly T[] {
  return takeRoundRobin({
    groups,
    count: groups.reduce((sum, group) => sum + group.length, 0),
  });
}

function divergenceLabel(kind: string): string {
  switch (kind) {
    case "regular_bullish":
      return "Bull div";
    case "hidden_bullish":
      return "H bull";
    case "regular_bearish":
      return "Bear div";
    case "hidden_bearish":
      return "H bear";
    default:
      return "RSI div";
  }
}

function invalidationLabel(result: RsiDivergenceInvalidationResult): string {
  const invalidation = result.metadata?.["invalidation"];
  if (invalidation === "negative_agreement_tally") {
    return "invalid tally";
  }
  if (invalidation === "two_consecutive_disagreements") {
    return "invalid 2 loss";
  }
  return "invalidated";
}

function optionalDateSchema(description: string) {
  return z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : new Date(value)))
    .refine(
      (value) => value === undefined || Number.isFinite(value.getTime()),
      "must be a valid date/time",
    )
    .describe(description);
}

function timestampForFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
