import { CANDIDATE_BACKTEST_START_MS } from "@alea/constants/backtest";
import { TRADE_DECISION_DEFAULT_ASSETS } from "@alea/constants/tradeDecision";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import type { DatabaseClient } from "@alea/lib/db/types";
import { ambiguousTrendStructuralCheck } from "@alea/lib/filters/ambiguousTrend";
import {
  type AmbiguousTrendBaseConfig,
  findAmbiguousTrendMatch,
} from "@alea/lib/filters/ambiguousTrendCore";
import {
  runThesisLifecycle,
  type ThesisLifecycleConfig,
} from "@alea/lib/filters/thesisLifecycle";
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

type SweepConfig = AmbiguousTrendBaseConfig & ThesisLifecycleConfig;

const emaPairs = [
  { fastEmaLength: 20, slowEmaLength: 50 },
  { fastEmaLength: 12, slowEmaLength: 26 },
  { fastEmaLength: 9, slowEmaLength: 21 },
] as const;
const slopeLookbackValues = [1, 3, 5] as const;
const minSlopePctValues = [0, 0.0005, 0.002] as const;
const maxBodyPctValues = [0.05, 0.1, 0.15, 0.2] as const;
const closeLocBandsValues = [
  { minCloseLocation: 0.35, maxCloseLocation: 0.65 },
  { minCloseLocation: 0.3, maxCloseLocation: 0.7 },
  { minCloseLocation: 0.4, maxCloseLocation: 0.6 },
] as const;
const requireCloseAcrossSlowEmaValues = [false, true] as const;
const maxAgeValues = [4, 8, 16] as const;
const maxConsecutiveWrongValues = [1, 2] as const;
const requireWrongLessThanRightValues = [false, true] as const;
const requireFirstTradeWinValues = [false, true] as const;

const candidateCount =
  emaPairs.length *
  slopeLookbackValues.length *
  minSlopePctValues.length *
  maxBodyPctValues.length *
  closeLocBandsValues.length *
  requireCloseAcrossSlowEmaValues.length *
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

export const researchAmbiguousTrendSweepCommand = defineCommand({
  name: "research:ambiguous-trend-sweep",
  summary: "Sweep 1h ambiguous-synth trend candidates",
  description:
    "Runs a local research sweep for the Ambiguous-Synth Trend Continuation filter on 1h markets. Trigger fires only when the synthetic bar's body and close-location are inside an ambiguity window (the synth-direction baseline is weak in this regime), then predicts direction from the prevailing EMA trend (stack alignment + slope + optional close-across-slow-ema). Lifecycle invalidates on max age, consecutive wrong bars, wrong>right, or a close back through the slow EMA against the trend.",
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
    "bun alea research:ambiguous-trend-sweep",
    "bun alea research:ambiguous-trend-sweep --assets btc,eth",
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
      `${pc.bold("research:ambiguous-trend-sweep")} ${pc.dim(`${new Date(options.start).toISOString()} -> ${new Date(options.end).toISOString()}`)} ${pc.dim(`assets=${assets.join(",")}`)} ${pc.dim(`candidates=${candidateCount}`)}\n`,
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
      "Sweep Ambiguous-Synth Trend Continuation candidates on 1h markets. Filter targets the synth-bar regime where the body+closeLoc baseline is weak.",
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
    emaPairs,
    slopeLookbackValues,
    minSlopePctValues,
    maxBodyPctValues,
    closeLocBandsValues,
    requireCloseAcrossSlowEmaValues,
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
    slug: "one-hour-ambiguous-trend-sweep",
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

  for (const emaPair of emaPairs) {
    for (const slopeLookback of slopeLookbackValues) {
      for (const minSlopePct of minSlopePctValues) {
        for (const maxBodyPct of maxBodyPctValues) {
          for (const closeLocBand of closeLocBandsValues) {
            for (const requireCloseAcrossSlowEma of requireCloseAcrossSlowEmaValues) {
              const baseConfig: AmbiguousTrendBaseConfig = {
                ...emaPair,
                slopeLookback,
                minSlopePct,
                maxBodyPct,
                ...closeLocBand,
                requireCloseAcrossSlowEma,
              };
              const match = findAmbiguousTrendMatch({
                bars,
                config: baseConfig,
              });
              if (!match.matched) {
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
                      const lifecycle = runThesisLifecycle({
                        direction: match.trigger.direction,
                        confirmedIndex: match.trigger.confirmedIndex,
                        bars,
                        lastIndex: match.lastIndex,
                        config: lifecycleConfig,
                        structuralCheck: ambiguousTrendStructuralCheck({
                          slowEmaSeries: match.slowEmaSeries,
                        }),
                      });
                      if (lifecycle.invalidated) {
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
}

function configKey(config: SweepConfig): string {
  return [
    `f=${config.fastEmaLength}`,
    `s=${config.slowEmaLength}`,
    `slope=${config.slopeLookback}`,
    `mSlope=${config.minSlopePct}`,
    `mBody=${config.maxBodyPct}`,
    `cLo=${config.minCloseLocation}`,
    `cHi=${config.maxCloseLocation}`,
    `xEma=${config.requireCloseAcrossSlowEma}`,
    `mAge=${config.maxAge}`,
    `mCons=${config.maxConsecutiveWrong}`,
    `wLR=${config.requireWrongLessThanRight}`,
    `first=${config.requireFirstTradeWin}`,
  ].join("|");
}
