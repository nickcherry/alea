import { CANDIDATE_BACKTEST_START_MS } from "@alea/constants/backtest";
import { TRADE_DECISION_DEFAULT_ASSETS } from "@alea/constants/tradeDecision";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import type { DatabaseClient } from "@alea/lib/db/types";
import { maRejectionStructuralCheck } from "@alea/lib/filters/maRejection";
import {
  detectMaRejectionAt,
  type MaRejectionBaseConfig,
  type MaRejectionTrigger,
} from "@alea/lib/filters/maRejectionCore";
import {
  runThesisLifecycle,
  type ThesisLifecycleConfig,
} from "@alea/lib/filters/thesisLifecycle";
import { computeEmaSeries } from "@alea/lib/indicators/ema";
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

type SweepConfig = MaRejectionBaseConfig & ThesisLifecycleConfig;

const emaStacks = [
  { fastEmaLength: 20, midEmaLength: 50, slowEmaLength: 100 },
  { fastEmaLength: 12, midEmaLength: 26, slowEmaLength: 50 },
] as const;
const touchTolerancePctValues = [0.0005, 0.002, 0.005] as const;
const minLowerWickPctValues = [0.15, 0.25, 0.35] as const;
const minCloseLocationValues = [0.55, 0.65, 0.75] as const;
const maxSignalAgeBarsValues = [0, 1, 3] as const;
const maxAgeValues = [4, 8, 16] as const;
const maxConsecutiveWrongValues = [1, 2] as const;
const requireWrongLessThanRightValues = [false, true] as const;
const requireFirstTradeWinValues = [false, true] as const;

const candidateCount =
  emaStacks.length *
  touchTolerancePctValues.length *
  minLowerWickPctValues.length *
  minCloseLocationValues.length *
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

export const researchMaRejectionSweepCommand = defineCommand({
  name: "research:ma-rejection-sweep",
  summary: "Sweep 1h MA-rejection candidates",
  description:
    "Runs a local research sweep for the Moving-Average Rejection filter on 1h markets. Trigger requires a stacked-EMA trend, the current bar's low (or high for shorts) piercing the fast/mid EMA, and a close back through the fast EMA with a strong wick and close-location. Lifecycle invalidates on max age, consecutive wrong bars, wrong>right, or a close back through the fast EMA against trend.",
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
    "bun alea research:ma-rejection-sweep",
    "bun alea research:ma-rejection-sweep --assets btc,eth",
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
      `${pc.bold("research:ma-rejection-sweep")} ${pc.dim(`${new Date(options.start).toISOString()} -> ${new Date(options.end).toISOString()}`)} ${pc.dim(`assets=${assets.join(",")}`)} ${pc.dim(`candidates=${candidateCount}`)}\n`,
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
    const assetStarted = Date.now();
    const targets = await loadSweepTargets({ db, asset, startMs, endMs, log });
    recordCount += targets.length;
    for (const target of targets) {
      quarterLabels.add(target.quarter);
    }
    let processedTargets = 0;
    for (const target of targets) {
      evaluateTarget({ target, stats });
      processedTargets += 1;
      if (
        processedTargets % 2000 === 0 ||
        processedTargets === targets.length
      ) {
        log(
          JSON.stringify({
            kind: "asset-progress",
            asset,
            processedTargets,
            totalTargets: targets.length,
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
      "Sweep Moving-Average Rejection candidates on 1h markets with shared thesis lifecycle invalidation.",
    outcomeSource:
      "Pyth spot 1h candle direction. This does not include Polymarket market prices or odds.",
    decisionTiming:
      "For each 1h target candle, decide 35 minutes before the target candle opens using a synthetic of the prior (in-progress) hour built from 1m Pyth candles through `target.open - 35min`. The filter never sees any data from the target candle itself.",
    startMs,
    endMs,
    assets,
    timeframe: "1h",
    records: recordCount,
    candidateCount,
    emaStacks,
    touchTolerancePctValues,
    minLowerWickPctValues,
    minCloseLocationValues,
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
    slug: "one-hour-ma-rejection-sweep",
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

const maxAgeWindow = Math.max(...maxSignalAgeBarsValues);

function evaluateTarget({
  target,
  stats,
}: {
  readonly target: SweepTargetRecord;
  readonly stats: Map<string, SweepCandidateStat<SweepConfig>>;
}): void {
  const bars: readonly MarketBar[] = [...target.history, target.syntheticBar];
  const lastIndex = bars.length - 1;
  const earliest = Math.max(0, lastIndex - maxAgeWindow);
  const closes = bars.map((b) => b.close);

  for (const stack of emaStacks) {
    const fastEmaSeries = computeEmaSeries({
      closes,
      period: stack.fastEmaLength,
    });
    const midEmaSeries = computeEmaSeries({
      closes,
      period: stack.midEmaLength,
    });
    const slowEmaSeries = computeEmaSeries({
      closes,
      period: stack.slowEmaLength,
    });
    for (const touchTolerancePct of touchTolerancePctValues) {
      for (const minLowerWickPct of minLowerWickPctValues) {
        for (const minCloseLocation of minCloseLocationValues) {
          const triggers: {
            readonly trigger: MaRejectionTrigger;
            readonly barsAgo: number;
          }[] = [];
          const baseConfig: MaRejectionBaseConfig = {
            ...stack,
            touchTolerancePct,
            minLowerWickPct,
            minCloseLocation,
            maxSignalAgeBars: maxAgeWindow,
          };
          for (let i = earliest; i <= lastIndex; i += 1) {
            const trigger = detectMaRejectionAt({
              bars,
              index: i,
              fastEmaSeries,
              midEmaSeries,
              slowEmaSeries,
              config: baseConfig,
            });
            if (trigger !== undefined) {
              triggers.push({ trigger, barsAgo: lastIndex - i });
            }
          }
          if (triggers.length === 0) {
            continue;
          }
          const lifecycleCache = new Map<string, boolean>();
          for (const maxSignalAgeBars of maxSignalAgeBarsValues) {
            let selected:
              | {
                  readonly trigger: MaRejectionTrigger;
                  readonly barsAgo: number;
                }
              | undefined;
            for (let i = triggers.length - 1; i >= 0; i -= 1) {
              if (triggers[i]!.barsAgo <= maxSignalAgeBars) {
                selected = triggers[i];
                break;
              }
            }
            if (selected === undefined) {
              continue;
            }
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
                    const cacheKey = `${selected.trigger.confirmedIndex}|${maxAge}|${maxConsecutiveWrong}|${requireWrongLessThanRight ? 1 : 0}|${requireFirstTradeWin ? 1 : 0}`;
                    let invalidated = lifecycleCache.get(cacheKey);
                    if (invalidated === undefined) {
                      const result = runThesisLifecycle({
                        direction: selected.trigger.direction,
                        confirmedIndex: selected.trigger.confirmedIndex,
                        bars,
                        lastIndex,
                        config: lifecycleConfig,
                        structuralCheck: maRejectionStructuralCheck({
                          fastEmaSeries,
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
                      maxSignalAgeBars,
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
                      won: selected.trigger.direction === target.outcome,
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
    `f=${config.fastEmaLength}`,
    `m=${config.midEmaLength}`,
    `s=${config.slowEmaLength}`,
    `tol=${config.touchTolerancePct}`,
    `wick=${config.minLowerWickPct}`,
    `cLoc=${config.minCloseLocation}`,
    `age=${config.maxSignalAgeBars}`,
    `mAge=${config.maxAge}`,
    `mCons=${config.maxConsecutiveWrong}`,
    `wLR=${config.requireWrongLessThanRight}`,
    `first=${config.requireFirstTradeWin}`,
  ].join("|");
}
