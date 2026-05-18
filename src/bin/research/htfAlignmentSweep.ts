import { CANDIDATE_BACKTEST_START_MS } from "@alea/constants/backtest";
import { TRADE_DECISION_DEFAULT_ASSETS } from "@alea/constants/tradeDecision";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import type { DatabaseClient } from "@alea/lib/db/types";
import {
  detectHtfAlignmentAt,
  type HtfAlignmentBaseConfig,
  type HtfAlignmentTrigger,
} from "@alea/lib/filters/htfAlignmentCore";
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

type SweepConfig = HtfAlignmentBaseConfig & ThesisLifecycleConfig;

const htfWindowValues = [4, 6, 8, 12, 24] as const;
const minReturnPctValues = [0.005, 0.01, 0.02, 0.03] as const;
const requireSynthAlignmentValues = [false, true] as const;
const maxSignalAgeBarsValues = [0, 1, 3] as const;
const maxAgeValues = [4, 8, 16] as const;
const maxConsecutiveWrongValues = [1, 2] as const;
const requireWrongLessThanRightValues = [false, true] as const;
const requireFirstTradeWinValues = [false, true] as const;

const candidateCount =
  htfWindowValues.length *
  minReturnPctValues.length *
  requireSynthAlignmentValues.length *
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

export const researchHtfAlignmentSweepCommand = defineCommand({
  name: "research:htf-alignment-sweep",
  summary: "Sweep 1h HTF-alignment candidates",
  description:
    "Runs a local research sweep for the Higher-Timeframe Alignment filter on 1h markets. Trigger bets in the direction of a multi-bar cumulative return (N closed 1h bars + the synth bar's close), optionally requiring the synth bar to also be moving the same way.",
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
    "bun alea research:htf-alignment-sweep",
    "bun alea research:htf-alignment-sweep --assets btc,eth",
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
      `${pc.bold("research:htf-alignment-sweep")} ${pc.dim(`${new Date(options.start).toISOString()} -> ${new Date(options.end).toISOString()}`)} ${pc.dim(`assets=${assets.join(",")}`)} ${pc.dim(`candidates=${candidateCount}`)}\n`,
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
      "Sweep HTF Alignment candidates on 1h markets — bet in the direction of a multi-bar cumulative return.",
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
    htfWindowValues,
    minReturnPctValues,
    requireSynthAlignmentValues,
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
    slug: "one-hour-htf-alignment-sweep",
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

  for (const htfWindow of htfWindowValues) {
    for (const minReturnPct of minReturnPctValues) {
      for (const requireSynthAlignment of requireSynthAlignmentValues) {
        const triggers: {
          readonly trigger: HtfAlignmentTrigger;
          readonly barsAgo: number;
        }[] = [];
        const baseConfig: HtfAlignmentBaseConfig = {
          htfWindow,
          minReturnPct,
          requireSynthAlignment,
          maxSignalAgeBars: maxAgeWindow,
        };
        for (let i = earliest; i <= lastIndex; i += 1) {
          const trigger = detectHtfAlignmentAt({
            bars,
            index: i,
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
                readonly trigger: HtfAlignmentTrigger;
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

function configKey(config: SweepConfig): string {
  return [
    `htf=${config.htfWindow}`,
    `ret=${config.minReturnPct}`,
    `synth=${config.requireSynthAlignment}`,
    `age=${config.maxSignalAgeBars}`,
    `mAge=${config.maxAge}`,
    `mCons=${config.maxConsecutiveWrong}`,
    `wLR=${config.requireWrongLessThanRight}`,
    `first=${config.requireFirstTradeWin}`,
  ].join("|");
}
