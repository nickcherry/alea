import { writeFileSync } from "node:fs";

import { TRADE_DECISION_DEFAULT_ASSETS } from "@alea/constants/tradeDecision";
import {
  quarterLabelFor,
  quarterStartFor,
} from "@alea/lib/backtest/cache";
import { timeframeMs } from "@alea/lib/candles/timeframeMs";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import type { DatabaseClient } from "@alea/lib/db/types";
import { computeWilderRsiSeries } from "@alea/lib/indicators/rsi";
import {
  computeRsiDivergenceSignals,
  type RsiDivergenceKind,
  type RsiDivergenceSignal,
} from "@alea/lib/indicators/rsiDivergence";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { resolveDirectionalOutcome } from "@alea/lib/reliability/resolveDirectionalOutcome";
import type { Asset } from "@alea/types/assets";
import pc from "picocolors";
import { z } from "zod";

type Direction = "up" | "down";

type BaseConfig = {
  readonly rsiLength: number;
  readonly leftBars: number;
  readonly rightBars: number;
  readonly rangeLower: number;
  readonly rangeUpper: number;
};

type SweepConfig = BaseConfig & {
  readonly includeHidden: boolean;
  readonly maxSignalAgeBars: number;
  readonly minAgreementScore: number;
  readonly maxConsecutiveDisagreements: number;
};

type BasicStat = {
  n: number;
  wins: number;
  losses: number;
};

type CandidateStat = BasicStat & {
  readonly config: SweepConfig;
  readonly quarters: Map<string, BasicStat>;
  readonly assets: Map<string, BasicStat>;
};

type TargetRecord = {
  readonly asset: Asset;
  readonly quarter: string;
  readonly targetBar: MarketBar;
  readonly syntheticBar: MarketBar;
  readonly history: readonly MarketBar[];
  readonly outcome: Direction;
};

const DEFAULT_START_MS = Date.UTC(2025, 0, 1);
const ONE_MINUTE_MS = timeframeMs({ timeframe: "1m" });
const ONE_HOUR_MS = timeframeMs({ timeframe: "1h" });
const DECISION_BEFORE_CLOSE_MS = 10 * ONE_MINUTE_MS;
const DECISION_AFTER_OPEN_MS = ONE_HOUR_MS - DECISION_BEFORE_CLOSE_MS;
const HISTORY_BARS = 340;

const assetSchema = z.enum(TRADE_DECISION_DEFAULT_ASSETS);
const commaSeparatedAssetsSchema = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined
      ? undefined
      : value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(assetSchema).min(1).optional());

const rsiLengths = [7, 9, 14, 21, 28] as const;
const pivotBarsValues = [2, 3, 5, 7] as const;
const rangePairs = [
  { rangeLower: 2, rangeUpper: 30 },
  { rangeLower: 2, rangeUpper: 60 },
  { rangeLower: 5, rangeUpper: 60 },
  { rangeLower: 5, rangeUpper: 100 },
] as const;
const includeHiddenValues = [false, true] as const;
const maxSignalAgeBarsValues = [0, 1, 2, 3, 5, 8, 13, 20, 30, 40] as const;
const minAgreementScoreValues = [0, -1, -2, -3] as const;
const maxConsecutiveDisagreementValues = [1, 2, 3, 4] as const;

const baseConfigs = buildBaseConfigs();
const candidateCount =
  baseConfigs.length *
  includeHiddenValues.length *
  maxSignalAgeBarsValues.length *
  minAgreementScoreValues.length *
  maxConsecutiveDisagreementValues.length;

export const researchRsiDivergenceSweepCommand = defineCommand({
  name: "research:rsi-divergence-sweep",
  summary: "Sweep 1h RSI divergence configs",
  description:
    "Runs a formal local research sweep for TradingView-style RSI divergence candidates on 1h markets. Each simulated decision happens 10 minutes before the current 1h market closes, using a synthetic current-hour candle built only from stored 1m Pyth bars available by HH:50.",
  options: [
    defineValueOption({
      key: "assets",
      long: "--assets",
      valueName: "LIST",
      schema: commaSeparatedAssetsSchema.describe(
        `Comma-separated assets. Defaults to ${TRADE_DECISION_DEFAULT_ASSETS.join(",")}.`,
      ),
    }),
    defineValueOption({
      key: "start",
      long: "--start",
      valueName: "YYYY-MM-DD",
      schema: z
        .string()
        .optional()
        .transform((value) =>
          value === undefined ? DEFAULT_START_MS : parseDateMs(value),
        )
        .describe("Inclusive UTC start date."),
    }),
    defineValueOption({
      key: "end",
      long: "--end",
      valueName: "YYYY-MM-DD",
      schema: z
        .string()
        .optional()
        .transform((value) =>
          value === undefined ? Date.now() : parseDateMs(value),
        )
        .describe("Exclusive UTC end date. Defaults to now."),
    }),
  ],
  examples: [
    "bun alea research:rsi-divergence-sweep",
    "bun alea research:rsi-divergence-sweep --assets btc,eth",
  ],
  output:
    "Writes a JSON artifact under doc/results-artifacts and prints the artifact path plus top rows.",
  sideEffects:
    "Reads stored Pyth 1m and 1h candles. Does not write database rows.",
  async run({ io, options }) {
    const assets = (options.assets ??
      TRADE_DECISION_DEFAULT_ASSETS) as readonly Asset[];
    if (options.end <= options.start) {
      throw new Error("--end must be after --start");
    }
    io.writeStdout(
      `${pc.bold("research:rsi-divergence-sweep")} ${pc.dim(`${new Date(options.start).toISOString()} -> ${new Date(options.end).toISOString()}`)} ${pc.dim(`assets=${assets.join(",")}`)}\n`,
    );
    const db = createDatabase();
    try {
      const result = await runSweep({
        db,
        assets,
        startMs: options.start,
        endMs: options.end,
        log: (line) => io.writeStdout(`${line}\n`),
      });
      io.writeStdout(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
      await destroyDatabase(db);
    }
  },
});

async function runSweep({
  db,
  assets,
  startMs,
  endMs,
  log,
}: {
  readonly db: DatabaseClient;
  readonly assets: readonly Asset[];
  readonly startMs: number;
  readonly endMs: number;
  readonly log: (line: string) => void;
}): Promise<Readonly<Record<string, unknown>>> {
  const started = Date.now();
  const stats = new Map<string, CandidateStat>();
  let recordCount = 0;
  const quarterLabels = new Set<string>();

  for (const asset of assets) {
    const assetStarted = Date.now();
    const targets = await loadTargets({ db, asset, startMs, endMs, log });
    recordCount += targets.length;
    for (const target of targets) {
      quarterLabels.add(target.quarter);
    }

    for (let configIndex = 0; configIndex < baseConfigs.length; configIndex += 1) {
      const baseConfig = baseConfigs[configIndex]!;
      for (const target of targets) {
        evaluateTargetBaseConfig({
          target,
          baseConfig,
          stats,
        });
      }
      if ((configIndex + 1) % 10 === 0 || configIndex + 1 === baseConfigs.length) {
        log(
          JSON.stringify({
            kind: "asset-progress",
            asset,
            baseConfigsDone: configIndex + 1,
            baseConfigs: baseConfigs.length,
            elapsedMs: Date.now() - assetStarted,
          }),
        );
      }
    }
  }

  const allQuarterLabels = [...quarterLabels].sort();
  const artifact = {
    generatedAt: new Date().toISOString(),
    runtimeMs: Date.now() - started,
    objective:
      "Sweep TradingView-style RSI divergence candidates on 1h markets with agreement-tally invalidation and a no-leak synthetic current hour.",
    outcomeSource:
      "Pyth spot 1h candle direction. This does not include Polymarket market prices or odds.",
    decisionTiming:
      "For each 1h target candle, decide 10 minutes before that same candle closes by appending a synthetic current-hour bar built from 1m Pyth candles through HH:50.",
    startMs,
    endMs,
    assets,
    timeframe: "1h",
    records: recordCount,
    baseConfigCount: baseConfigs.length,
    candidateCount,
    rsiLengths,
    pivotBarsValues,
    rangePairs,
    includeHiddenValues,
    maxSignalAgeBarsValues,
    minAgreementScoreValues,
    maxConsecutiveDisagreementValues,
    topOverall: topStats({
      stats,
      assets,
      recordCount,
      quarterLabels: allQuarterLabels,
      minDecisions: 50,
    }).slice(0, 120),
    topAtLeast500: topStats({
      stats,
      assets,
      recordCount,
      quarterLabels: allQuarterLabels,
      minDecisions: 500,
    }).slice(0, 80),
    topAtLeast1000: topStats({
      stats,
      assets,
      recordCount,
      quarterLabels: allQuarterLabels,
      minDecisions: 1000,
    }).slice(0, 80),
    topByHiddenMode: Object.fromEntries(
      includeHiddenValues.map((includeHidden) => [
        String(includeHidden),
        topStats({
          stats,
          assets,
          recordCount,
          quarterLabels: allQuarterLabels,
          minDecisions: 500,
          filter: (stat) => stat.config.includeHidden === includeHidden,
        }).slice(0, 40),
      ]),
    ),
    topByConsecutiveDisagreementLimit: Object.fromEntries(
      maxConsecutiveDisagreementValues.map((limit) => [
        String(limit),
        topStats({
          stats,
          assets,
          recordCount,
          quarterLabels: allQuarterLabels,
          minDecisions: 500,
          filter: (stat) => stat.config.maxConsecutiveDisagreements === limit,
        }).slice(0, 40),
      ]),
    ),
    topByAgreementScoreFloor: Object.fromEntries(
      minAgreementScoreValues.map((floor) => [
        String(floor),
        topStats({
          stats,
          assets,
          recordCount,
          quarterLabels: allQuarterLabels,
          minDecisions: 500,
          filter: (stat) => stat.config.minAgreementScore === floor,
        }).slice(0, 40),
      ]),
    ),
    topRobust: topStats({
      stats,
      assets,
      recordCount,
      quarterLabels: allQuarterLabels,
      minDecisions: 200,
    })
      .filter(
        (row) =>
          row.coveredQuarters === row.quarterCount &&
          row.positiveQuarters === row.quarterCount &&
          row.coveredAssets === assets.length &&
          row.positiveAssets === assets.length,
      )
      .slice(0, 80),
  };

  const outPath = `doc/results-artifacts/${new Date()
    .toISOString()
    .replaceAll(":", "-")}-one-hour-rsi-divergence-sweep.json`;
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return {
    outPath,
    runtimeMs: artifact.runtimeMs,
    records: artifact.records,
    baseConfigCount: artifact.baseConfigCount,
    candidateCount: artifact.candidateCount,
    topOverall: artifact.topOverall.slice(0, 20),
    topRobust: artifact.topRobust.slice(0, 20),
  };
}

function parseDateMs(value: string): number {
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) {
    throw new Error(`invalid date: ${value}`);
  }
  return ms;
}

function buildBaseConfigs(): readonly BaseConfig[] {
  const configs: BaseConfig[] = [];
  for (const rsiLength of rsiLengths) {
    for (const pivotBars of pivotBarsValues) {
      for (const range of rangePairs) {
        configs.push({
          rsiLength,
          leftBars: pivotBars,
          rightBars: pivotBars,
          rangeLower: range.rangeLower,
          rangeUpper: range.rangeUpper,
        });
      }
    }
  }
  return configs;
}

async function loadTargets({
  db,
  asset,
  startMs,
  endMs,
  log,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly startMs: number;
  readonly endMs: number;
  readonly log: (line: string) => void;
}): Promise<readonly TargetRecord[]> {
  const historyStartMs = Math.max(0, startMs - HISTORY_BARS * ONE_HOUR_MS);
  const [hourBars, minuteBars] = await Promise.all([
    loadPythBars({
      db,
      asset,
      timeframe: "1h",
      startMs: historyStartMs,
      endMs,
    }),
    loadPythBars({
      db,
      asset,
      timeframe: "1m",
      startMs,
      endMs,
    }),
  ]);
  const targets: TargetRecord[] = [];
  const firstTargetIndex = lowerBoundOpenTime({
    bars: hourBars,
    openTimeMs: startMs,
  });
  for (let i = firstTargetIndex; i < hourBars.length; i += 1) {
    const targetBar = hourBars[i]!;
    if (targetBar.openTimeMs >= endMs) {
      break;
    }
    const decisionTsMs = targetBar.openTimeMs + DECISION_AFTER_OPEN_MS;
    if (decisionTsMs > endMs) {
      continue;
    }
    const syntheticBar = synthesizePartialBar({
      minuteBars,
      activeOpenTimeMs: targetBar.openTimeMs,
      decisionTsMs,
    });
    if (syntheticBar === null) {
      continue;
    }
    const history = hourBars.slice(Math.max(0, i - HISTORY_BARS), i);
    if (history.length < 80) {
      continue;
    }
    targets.push({
      asset,
      quarter: quarterLabelFor({
        quarterStartMs: quarterStartFor({ tsMs: targetBar.openTimeMs }),
      }),
      targetBar,
      syntheticBar,
      history,
      outcome: resolveDirectionalOutcome({
        startPrice: targetBar.open,
        endPrice: targetBar.close,
      }),
    });
  }
  log(
    JSON.stringify({
      kind: "asset-loaded",
      asset,
      hourBars: hourBars.length,
      minuteBars: minuteBars.length,
      targets: targets.length,
    }),
  );
  return targets;
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
  readonly timeframe: "1m" | "1h";
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

function evaluateTargetBaseConfig({
  target,
  baseConfig,
  stats,
}: {
  readonly target: TargetRecord;
  readonly baseConfig: BaseConfig;
  readonly stats: Map<string, CandidateStat>;
}): void {
  const bars = [...target.history, target.syntheticBar];
  const closes = bars.map((bar) => bar.close);
  const rsi = computeWilderRsiSeries({
    closes,
    period: baseConfig.rsiLength,
  });
  const signals = computeRsiDivergenceSignals({
    bars,
    rsi,
    leftBars: baseConfig.leftBars,
    rightBars: baseConfig.rightBars,
    rangeLower: baseConfig.rangeLower,
    rangeUpper: baseConfig.rangeUpper,
  });
  if (signals.length === 0) {
    return;
  }

  const lastIndex = bars.length - 1;
  const invalidationCache = new Map<string, boolean>();
  for (const includeHidden of includeHiddenValues) {
    for (const maxSignalAgeBars of maxSignalAgeBarsValues) {
      const signal = selectRecentSignal({
        signals,
        lastIndex,
        includeHidden,
        maxSignalAgeBars,
      });
      if (signal === undefined) {
        continue;
      }
      const decision = isBullish(signal.kind) ? "up" : "down";
      for (const minAgreementScore of minAgreementScoreValues) {
        for (const maxConsecutiveDisagreements of maxConsecutiveDisagreementValues) {
          const config = {
            ...baseConfig,
            includeHidden,
            maxSignalAgeBars,
            minAgreementScore,
            maxConsecutiveDisagreements,
          } satisfies SweepConfig;
          const invalidationKey = [
            signal.confirmedIndex,
            decision,
            minAgreementScore,
            maxConsecutiveDisagreements,
          ].join(":");
          const invalidated =
            invalidationCache.get(invalidationKey) ??
            isInvalidated({
              bars,
              signal,
              decision,
              minAgreementScore,
              maxConsecutiveDisagreements,
            });
          invalidationCache.set(invalidationKey, invalidated);
          if (invalidated) {
            continue;
          }
          const key = configKey(config);
          const stat = getCandidateStat({ stats, key, config });
          addDecision({
            stat,
            asset: target.asset,
            quarter: target.quarter,
            won: decision === target.outcome,
          });
        }
      }
    }
  }
}

function selectRecentSignal({
  signals,
  lastIndex,
  includeHidden,
  maxSignalAgeBars,
}: {
  readonly signals: readonly RsiDivergenceSignal[];
  readonly lastIndex: number;
  readonly includeHidden: boolean;
  readonly maxSignalAgeBars: number;
}): RsiDivergenceSignal | undefined {
  for (let i = signals.length - 1; i >= 0; i -= 1) {
    const signal = signals[i]!;
    if (signal.confirmedIndex > lastIndex) {
      continue;
    }
    if (!includeHidden && signal.kind.startsWith("hidden_")) {
      continue;
    }
    const barsAgo = lastIndex - signal.confirmedIndex;
    if (barsAgo <= maxSignalAgeBars) {
      return signal;
    }
  }
  return undefined;
}

function isInvalidated({
  bars,
  signal,
  decision,
  minAgreementScore,
  maxConsecutiveDisagreements,
}: {
  readonly bars: readonly MarketBar[];
  readonly signal: RsiDivergenceSignal;
  readonly decision: Direction;
  readonly minAgreementScore: number;
  readonly maxConsecutiveDisagreements: number;
}): boolean {
  let agreementScore = 0;
  let consecutiveDisagreements = 0;
  for (
    let index = signal.confirmedIndex + 1;
    index < bars.length;
    index += 1
  ) {
    const bar = bars[index]!;
    const direction = agreementDirectionForBar({
      decision,
      open: bar.open,
      close: bar.close,
    });
    if (direction === "agreement") {
      agreementScore += 1;
      consecutiveDisagreements = 0;
    } else if (direction === "disagreement") {
      agreementScore -= 1;
      consecutiveDisagreements += 1;
    } else {
      consecutiveDisagreements = 0;
    }
    if (agreementScore < minAgreementScore) {
      return true;
    }
    if (consecutiveDisagreements >= maxConsecutiveDisagreements) {
      return true;
    }
  }
  return false;
}

function agreementDirectionForBar({
  decision,
  open,
  close,
}: {
  readonly decision: Direction;
  readonly open: number;
  readonly close: number;
}): "agreement" | "disagreement" | "flat" {
  if (close === open) {
    return "flat";
  }
  if (decision === "up") {
    return close > open ? "agreement" : "disagreement";
  }
  return close < open ? "agreement" : "disagreement";
}

function addDecision({
  stat,
  asset,
  quarter,
  won,
}: {
  readonly stat: CandidateStat;
  readonly asset: Asset;
  readonly quarter: string;
  readonly won: boolean;
}): void {
  addBasicDecision({ stat, won });
  addBasicDecision({ stat: getBasicStat(stat.quarters, quarter), won });
  addBasicDecision({ stat: getBasicStat(stat.assets, asset), won });
}

function addBasicDecision({
  stat,
  won,
}: {
  readonly stat: BasicStat;
  readonly won: boolean;
}): void {
  stat.n += 1;
  if (won) {
    stat.wins += 1;
  } else {
    stat.losses += 1;
  }
}

function getCandidateStat({
  stats,
  key,
  config,
}: {
  readonly stats: Map<string, CandidateStat>;
  readonly key: string;
  readonly config: SweepConfig;
}): CandidateStat {
  const existing = stats.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const stat = {
    n: 0,
    wins: 0,
    losses: 0,
    config,
    quarters: new Map<string, BasicStat>(),
    assets: new Map<string, BasicStat>(),
  };
  stats.set(key, stat);
  return stat;
}

function getBasicStat(
  map: Map<string, BasicStat>,
  key: string,
): BasicStat {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const stat = { n: 0, wins: 0, losses: 0 };
  map.set(key, stat);
  return stat;
}

function topStats({
  stats,
  assets,
  recordCount,
  quarterLabels,
  minDecisions,
  filter = () => true,
}: {
  readonly stats: ReadonlyMap<string, CandidateStat>;
  readonly assets: readonly Asset[];
  readonly recordCount: number;
  readonly quarterLabels: readonly string[];
  readonly minDecisions: number;
  readonly filter?: (stat: CandidateStat) => boolean;
}): readonly ReturnType<typeof summarizeStat>[] {
  return [...stats.entries()]
    .filter(([, stat]) => stat.n >= minDecisions && filter(stat))
    .map(([key, stat]) =>
      summarizeStat({
        key,
        stat,
        assets,
        recordCount,
        quarterLabels,
      }),
    )
    .sort((a, b) => b.winRate - a.winRate || b.decisions - a.decisions);
}

function summarizeStat({
  key,
  stat,
  assets,
  recordCount,
  quarterLabels,
}: {
  readonly key: string;
  readonly stat: CandidateStat;
  readonly assets: readonly Asset[];
  readonly recordCount: number;
  readonly quarterLabels: readonly string[];
}) {
  const quarterRates = quarterLabels.map((name) => {
    const quarter = stat.quarters.get(name);
    return {
      name,
      decisions: quarter?.n ?? 0,
      winRate: quarter === undefined || quarter.n === 0 ? null : pct(quarter.wins, quarter.n),
    };
  });
  const assetRates = assets.map((name) => {
    const asset = stat.assets.get(name);
    return {
      name,
      decisions: asset?.n ?? 0,
      winRate: asset === undefined || asset.n === 0 ? null : pct(asset.wins, asset.n),
    };
  });
  const coveredQuarters = quarterRates.filter((row) => row.decisions > 0).length;
  const coveredAssets = assetRates.filter((row) => row.decisions > 0).length;
  const positiveQuarters = quarterRates.filter(
    (row) => row.winRate !== null && row.winRate > 50,
  ).length;
  const positiveAssets = assetRates.filter(
    (row) => row.winRate !== null && row.winRate > 50,
  ).length;
  return {
    key,
    config: stat.config,
    decisions: stat.n,
    wins: stat.wins,
    losses: stat.losses,
    coverage: pct(stat.n, recordCount),
    winRate: pct(stat.wins, stat.n),
    quarterCount: quarterLabels.length,
    coveredQuarters,
    positiveQuarters,
    minQuarterWinRate: minRate(quarterRates),
    coveredAssets,
    positiveAssets,
    minAssetWinRate: minRate(assetRates),
    quarterRates,
    assetRates,
  };
}

function minRate(
  rows: readonly { readonly winRate: number | null }[],
): number | null {
  const rates = rows
    .map((row) => row.winRate)
    .filter((rate): rate is number => rate !== null);
  return rates.length === 0 ? null : Math.min(...rates);
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function configKey(config: SweepConfig): string {
  return [
    `rsi=${config.rsiLength}`,
    `pivot=${config.leftBars}`,
    `range=${config.rangeLower}-${config.rangeUpper}`,
    `hidden=${config.includeHidden}`,
    `age=${config.maxSignalAgeBars}`,
    `score=${config.minAgreementScore}`,
    `streak=${config.maxConsecutiveDisagreements}`,
  ].join("|");
}

function isBullish(kind: RsiDivergenceKind): boolean {
  return kind === "regular_bullish" || kind === "hidden_bullish";
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
    if (bar.openTimeMs + ONE_MINUTE_MS > decisionTsMs) {
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
