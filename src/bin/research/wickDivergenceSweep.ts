import { CANDIDATE_BACKTEST_START_MS } from "@alea/constants/backtest";
import { TRADE_DECISION_DEFAULT_ASSETS } from "@alea/constants/tradeDecision";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import type { DatabaseClient } from "@alea/lib/db/types";
import {
  runThesisLifecycle,
  type ThesisLifecycleConfig,
} from "@alea/lib/filters/thesisLifecycle";
import { wickDivergenceStructuralCheck } from "@alea/lib/filters/wickDivergence";
import {
  findRecentWickDivergence,
  type WickDivergenceBaseConfig,
} from "@alea/lib/filters/wickDivergenceCore";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import {
  getOrCreateCandidateStat,
  loadSweepTargets,
  parseSweepDateMs,
  recordSweepDecision,
  summarizeSweepStats,
  type SweepCandidateStat,
  type SweepTargetRecord,
  writeSweepArtifact,
} from "@alea/lib/research/sweepInfra";
import type { Asset } from "@alea/types/assets";
import pc from "picocolors";
import { z } from "zod";

type SweepConfig = WickDivergenceBaseConfig & ThesisLifecycleConfig;

const pivotBarsValues = [2, 3, 5] as const;
const rangePairs = [
  { rangeLower: 2, rangeUpper: 30 },
  { rangeLower: 2, rangeUpper: 60 },
  { rangeLower: 5, rangeUpper: 60 },
] as const;
const minCurrentWickPctValues = [0.1, 0.2, 0.3] as const;
const requireCloseLocImprovementValues = [false, true] as const;
const maxSignalAgeBarsValues = [0, 1, 3, 8, 13] as const;
const maxAgeValues = [4, 8, 16, 40] as const;
const maxConsecutiveWrongValues = [1, 2, 3] as const;
const requireWrongLessThanRightValues = [false, true] as const;
const requireFirstTradeWinValues = [false, true] as const;

const candidateCount =
  pivotBarsValues.length *
  rangePairs.length *
  minCurrentWickPctValues.length *
  requireCloseLocImprovementValues.length *
  maxSignalAgeBarsValues.length *
  maxAgeValues.length *
  maxConsecutiveWrongValues.length *
  requireWrongLessThanRightValues.length *
  requireFirstTradeWinValues.length;

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

export const researchWickDivergenceSweepCommand = defineCommand({
  name: "research:wick-divergence-sweep",
  summary: "Sweep 1h wick-divergence candidates",
  description:
    "Runs a local research sweep for the Wick Divergence filter on 1h markets. Trigger compares a confirmed swing-low (or swing-high) bar to the previous comparable pivot; if price made a lower low but the bar's lower wick is larger and optionally the close-location is stronger, votes bullish (mirror for shorts). Lifecycle invalidates on max age, consecutive wrong bars, wrong>right, or a close back through the current pivot extreme.",
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
          value === undefined
            ? CANDIDATE_BACKTEST_START_MS
            : parseSweepDateMs(value),
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
          value === undefined ? Date.now() : parseSweepDateMs(value),
        )
        .describe("Exclusive UTC end date. Defaults to now."),
    }),
  ],
  examples: [
    "bun alea research:wick-divergence-sweep",
    "bun alea research:wick-divergence-sweep --assets btc,eth",
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
      `${pc.bold("research:wick-divergence-sweep")} ${pc.dim(`${new Date(options.start).toISOString()} -> ${new Date(options.end).toISOString()}`)} ${pc.dim(`assets=${assets.join(",")}`)} ${pc.dim(`candidates=${candidateCount}`)}\n`,
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
  const stats = new Map<string, SweepCandidateStat<SweepConfig>>();
  let recordCount = 0;
  const quarterLabels = new Set<string>();

  for (const asset of assets) {
    const targets = await loadSweepTargets({ db, asset, startMs, endMs, log });
    recordCount += targets.length;
    for (const target of targets) {
      quarterLabels.add(target.quarter);
    }
    for (const target of targets) {
      evaluateTarget({ target, stats });
    }
  }
  const allQuarterLabels = [...quarterLabels].sort();
  const artifact = {
    generatedAt: new Date().toISOString(),
    runtimeMs: Date.now() - started,
    objective:
      "Sweep Wick Divergence candidates on 1h markets — RSI Divergence sibling using single-bar wick as the momentum proxy.",
    outcomeSource:
      "Pyth spot 1h candle direction. This does not include Polymarket market prices or odds.",
    decisionTiming:
      "For each 1h target candle, decide 35 minutes before that same candle closes using a synthetic current-hour bar built from 1m Pyth candles through HH:25.",
    startMs,
    endMs,
    assets,
    timeframe: "1h",
    records: recordCount,
    candidateCount,
    pivotBarsValues,
    rangePairs,
    minCurrentWickPctValues,
    requireCloseLocImprovementValues,
    maxSignalAgeBarsValues,
    maxAgeValues,
    maxConsecutiveWrongValues,
    requireWrongLessThanRightValues,
    requireFirstTradeWinValues,
    topOverall: summarizeSweepStats({
      stats,
      assets,
      recordCount,
      quarterLabels: allQuarterLabels,
      minDecisions: 100,
    }).slice(0, 120),
    topAtLeast500: summarizeSweepStats({
      stats,
      assets,
      recordCount,
      quarterLabels: allQuarterLabels,
      minDecisions: 500,
    }).slice(0, 80),
    topAtLeast1000: summarizeSweepStats({
      stats,
      assets,
      recordCount,
      quarterLabels: allQuarterLabels,
      minDecisions: 1000,
    }).slice(0, 80),
    topRobust: summarizeSweepStats({
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
  const outPath = writeSweepArtifact({
    slug: "one-hour-wick-divergence-sweep",
    payload: artifact,
  });
  return {
    outPath,
    runtimeMs: artifact.runtimeMs,
    records: artifact.records,
    candidateCount: artifact.candidateCount,
    topOverall: artifact.topOverall.slice(0, 20),
    topRobust: artifact.topRobust.slice(0, 20),
  };
}

function evaluateTarget({
  target,
  stats,
}: {
  readonly target: SweepTargetRecord;
  readonly stats: Map<string, SweepCandidateStat<SweepConfig>>;
}): void {
  const bars: readonly MarketBar[] = [...target.history, target.syntheticBar];

  for (const pivotBars of pivotBarsValues) {
    for (const range of rangePairs) {
      for (const minCurrentWickPct of minCurrentWickPctValues) {
        for (const requireCloseLocImprovement of requireCloseLocImprovementValues) {
          for (const maxSignalAgeBars of maxSignalAgeBarsValues) {
            const baseConfig: WickDivergenceBaseConfig = {
              leftBars: pivotBars,
              rightBars: pivotBars,
              rangeLower: range.rangeLower,
              rangeUpper: range.rangeUpper,
              minCurrentWickPct,
              requireCloseLocImprovement,
              maxSignalAgeBars,
            };
            const match = findRecentWickDivergence({
              bars,
              config: baseConfig,
            });
            if (!match.matched) {
              continue;
            }
            const lifecycleCache = new Map<string, boolean>();
            for (const maxAge of maxAgeValues) {
              for (const maxConsecutiveWrong of maxConsecutiveWrongValues) {
                for (const requireWrongLessThanRight of requireWrongLessThanRightValues) {
                  for (const requireFirstTradeWin of requireFirstTradeWinValues) {
                    const lifecycleConfig: ThesisLifecycleConfig = {
                      maxAge,
                      maxConsecutiveWrong,
                      requireWrongLessThanRight,
                      requireFirstTradeWin,
                    };
                    const cacheKey = `${match.trigger.confirmedIndex}|${maxAge}|${maxConsecutiveWrong}|${requireWrongLessThanRight ? 1 : 0}|${requireFirstTradeWin ? 1 : 0}`;
                    let invalidated = lifecycleCache.get(cacheKey);
                    if (invalidated === undefined) {
                      const result = runThesisLifecycle({
                        direction: match.trigger.direction,
                        confirmedIndex: match.trigger.confirmedIndex,
                        bars,
                        lastIndex: match.lastIndex,
                        config: lifecycleConfig,
                        structuralCheck: wickDivergenceStructuralCheck({
                          pivotExtreme: match.trigger.pivotExtreme,
                          direction: match.trigger.direction,
                        }),
                      });
                      invalidated = result.invalidated;
                      lifecycleCache.set(cacheKey, invalidated);
                    }
                    if (invalidated) {
                      continue;
                    }
                    const config: SweepConfig = {
                      ...baseConfig,
                      ...lifecycleConfig,
                    };
                    const key = configKey(config);
                    const stat = getOrCreateCandidateStat({
                      stats,
                      key,
                      config,
                    });
                    recordSweepDecision({
                      stat,
                      asset: target.asset,
                      quarter: target.quarter,
                      won: match.trigger.direction === target.outcome,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

function configKey(config: SweepConfig): string {
  return [
    `pivot=${config.leftBars}`,
    `range=${config.rangeLower}-${config.rangeUpper}`,
    `wick=${config.minCurrentWickPct}`,
    `closeImp=${config.requireCloseLocImprovement}`,
    `age=${config.maxSignalAgeBars}`,
    `mAge=${config.maxAge}`,
    `mCons=${config.maxConsecutiveWrong}`,
    `wLR=${config.requireWrongLessThanRight}`,
    `first=${config.requireFirstTradeWin}`,
  ].join("|");
}
