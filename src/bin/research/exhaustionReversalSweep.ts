import { CANDIDATE_BACKTEST_START_MS } from "@alea/constants/backtest";
import { TRADE_DECISION_DEFAULT_ASSETS } from "@alea/constants/tradeDecision";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import type { DatabaseClient } from "@alea/lib/db/types";
import { exhaustionReversalStructuralCheck } from "@alea/lib/filters/exhaustionReversal";
import {
  detectExhaustionReversalAt,
  type ExhaustionReversalBaseConfig,
  type ExhaustionReversalTrigger,
} from "@alea/lib/filters/exhaustionReversalCore";
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

type SweepConfig = ExhaustionReversalBaseConfig & ThesisLifecycleConfig;

const emaLength = 20;
const runWindowValues = [5, 7, 10] as const;
const minDirectionalRatios = [0.6, 0.75, 0.9] as const;
const minRunReturnPctValues = [0.005, 0.01, 0.02] as const;
const minDistanceFromEmaPctValues = [0.002, 0.005, 0.01] as const;
const minWickPctValues = [0.1, 0.2] as const;
const maxCloseLocationValues = [0.4, 0.45] as const;
const requireBodyShrinkValues = [false, true] as const;
const maxSignalAgeBarsValues = [0, 1, 3] as const;
const maxAgeValues = [4, 8, 12] as const;
const maxConsecutiveWrongValues = [1, 2] as const;
const requireWrongLessThanRightValues = [false, true] as const;
const requireFirstTradeWinValues = [false, true] as const;

const baseConfigs: readonly Pick<
  ExhaustionReversalBaseConfig,
  | "runWindow"
  | "minDirectionalCount"
  | "minRunReturnPct"
  | "minDistanceFromEmaPct"
  | "minWickPct"
  | "maxCloseLocation"
  | "requireBodyShrink"
>[] = (() => {
  const out: Pick<
    ExhaustionReversalBaseConfig,
    | "runWindow"
    | "minDirectionalCount"
    | "minRunReturnPct"
    | "minDistanceFromEmaPct"
    | "minWickPct"
    | "maxCloseLocation"
    | "requireBodyShrink"
  >[] = [];
  for (const runWindow of runWindowValues) {
    for (const ratio of minDirectionalRatios) {
      const minDirectionalCount = Math.max(
        2,
        Math.min(runWindow, Math.round(ratio * runWindow)),
      );
      for (const minRunReturnPct of minRunReturnPctValues) {
        for (const minDistanceFromEmaPct of minDistanceFromEmaPctValues) {
          for (const minWickPct of minWickPctValues) {
            for (const maxCloseLocation of maxCloseLocationValues) {
              for (const requireBodyShrink of requireBodyShrinkValues) {
                out.push({
                  runWindow,
                  minDirectionalCount,
                  minRunReturnPct,
                  minDistanceFromEmaPct,
                  minWickPct,
                  maxCloseLocation,
                  requireBodyShrink,
                });
              }
            }
          }
        }
      }
    }
  }
  return out;
})();

const candidateCount =
  baseConfigs.length *
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

export const researchExhaustionReversalSweepCommand = defineCommand({
  name: "research:exhaustion-reversal-sweep",
  summary: "Sweep 1h exhaustion-reversal candidates",
  description:
    "Runs a local research sweep for the Exhaustion Reversal filter on 1h markets. Trigger bets against an extended directional run when the current candle shows exhaustion (tall wick, weak close, optional body shrink) plus price extended away from its EMA. Lifecycle invalidates on max age, consecutive wrong bars, wrong>right, or a fresh close beyond the exhaustion candle's extreme.",
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
    "bun alea research:exhaustion-reversal-sweep",
    "bun alea research:exhaustion-reversal-sweep --assets btc,eth",
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
      `${pc.bold("research:exhaustion-reversal-sweep")} ${pc.dim(`${new Date(options.start).toISOString()} -> ${new Date(options.end).toISOString()}`)} ${pc.dim(`assets=${assets.join(",")}`)} ${pc.dim(`candidates=${candidateCount}`)}\n`,
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
      "Sweep Exhaustion Reversal candidates on 1h markets with shared thesis lifecycle invalidation.",
    outcomeSource:
      "Pyth spot 1h candle direction. This does not include Polymarket market prices or odds.",
    decisionTiming:
      "For each 1h target candle, decide 35 minutes before the target candle opens using a synthetic of the prior (in-progress) hour built from 1m Pyth candles through `target.open - 35min`. The filter never sees any data from the target candle itself.",
    startMs,
    endMs,
    assets,
    timeframe: "1h",
    records: recordCount,
    baseConfigCount: baseConfigs.length,
    candidateCount,
    emaLength,
    runWindowValues,
    minDirectionalRatios,
    minRunReturnPctValues,
    minDistanceFromEmaPctValues,
    minWickPctValues,
    maxCloseLocationValues,
    requireBodyShrinkValues,
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
    slug: "one-hour-exhaustion-reversal-sweep",
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
  const emaSeries = computeEmaSeries({ closes, period: emaLength });

  for (const base of baseConfigs) {
    const triggers: {
      readonly trigger: ExhaustionReversalTrigger;
      readonly barsAgo: number;
    }[] = [];
    const baseConfig: ExhaustionReversalBaseConfig = {
      ...base,
      emaLength,
      maxSignalAgeBars: maxAgeWindow,
    };
    for (let i = earliest; i <= lastIndex; i += 1) {
      const trigger = detectExhaustionReversalAt({
        bars,
        index: i,
        emaSeries,
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
            readonly trigger: ExhaustionReversalTrigger;
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
                  structuralCheck: exhaustionReversalStructuralCheck({
                    exhaustionExtreme: selected.trigger.exhaustionExtreme,
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
              const stat = getOrCreateCandidateStat({ stats, key, config });
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

function configKey(config: SweepConfig): string {
  return [
    `runW=${config.runWindow}`,
    `dirN=${config.minDirectionalCount}`,
    `retPct=${config.minRunReturnPct}`,
    `emaPct=${config.minDistanceFromEmaPct}`,
    `wick=${config.minWickPct}`,
    `cLoc=${config.maxCloseLocation}`,
    `shrink=${config.requireBodyShrink}`,
    `age=${config.maxSignalAgeBars}`,
    `mAge=${config.maxAge}`,
    `mCons=${config.maxConsecutiveWrong}`,
    `wLR=${config.requireWrongLessThanRight}`,
    `first=${config.requireFirstTradeWin}`,
  ].join("|");
}
