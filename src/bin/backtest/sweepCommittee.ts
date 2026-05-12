import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";

import { env } from "@alea/constants/env";
import {
  type CommitteeDecisionRules,
  DEFAULT_COMMITTEE_DECISION_RULES,
} from "@alea/constants/tradeDecision";
import { runCommitteeBacktest } from "@alea/lib/backtest/runCommitteeBacktest";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineFlagOption } from "@alea/lib/cli/defineFlagOption";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { buildCommitteeRosterFromSelections } from "@alea/lib/committee/selection/buildCommitteeRoster";
import { loadCandidateRegimeStats } from "@alea/lib/committee/selection/loadCandidateRegimeStats";
import { selectCommitteeCandidates } from "@alea/lib/committee/selection/selectCandidates";
import {
  type CandidateRegimeStats,
  type CommitteeSelectionRules,
  DEFAULT_COMMITTEE_SELECTION_RULES,
} from "@alea/lib/committee/selection/types";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import { wilsonInterval95 } from "@alea/lib/exploration/wilsonInterval";
import { sendTelegramMessage } from "@alea/lib/telegram/sendTelegramMessage";
import pc from "picocolors";
import { z } from "zod";

type SweepTrial = {
  readonly id: string;
  readonly hypothesis: string;
  readonly selectionRules: CommitteeSelectionRules;
  readonly decisionRules: CommitteeDecisionRules;
};

type SweepResult = {
  readonly trial: SweepTrial;
  readonly score: number;
  readonly passesHardFilters: boolean;
  readonly selectedCandidates: number;
  readonly winRate: number | null;
  readonly wilsonLow: number | null;
  readonly scoredTrades: number;
  readonly tradeRate: number | null;
  readonly positiveDayRate: number | null;
  readonly pnlUsd: number;
  readonly byPeriod: readonly {
    readonly label: string;
    readonly winRate: number | null;
    readonly scoredTrades: number;
    readonly tradeRate: number | null;
  }[];
};

export const backtestSweepCommitteeCommand = defineCommand({
  name: "backtest:sweep-committee",
  summary: "Explore committee selection and voting thresholds",
  description:
    "Runs transient committee holdout replays across selection and voting configurations without changing production constants or rewriting committee_selections. Results are ranked by a win-rate-first, volume-aware score and written to a JSON artifact.",
  options: [
    defineValueOption({
      key: "mode",
      long: "--mode",
      valueName: "MODE",
      choices: ["broad", "focus", "fine", "ridge", "macro", "stacked"],
      schema: z
        .enum(["broad", "focus", "fine", "ridge", "macro", "stacked"])
        .default("broad")
        .describe(
          "Sweep grid to run: broad first pass, focused ridge search, fine ridge search, strict/volume ridge search, macro stress test, or stacked macro test.",
        ),
    }),
    defineValueOption({
      key: "maxRuns",
      long: "--max-runs",
      valueName: "N",
      schema: z.coerce
        .number()
        .int()
        .positive()
        .default(80)
        .describe("Maximum number of sweep trials to run."),
    }),
    defineValueOption({
      key: "minScoredTrades",
      long: "--min-scored-trades",
      valueName: "N",
      schema: z.coerce
        .number()
        .int()
        .nonnegative()
        .default(2_000)
        .describe("Hard filter floor for scored trades in the ranking."),
    }),
    defineValueOption({
      key: "out",
      long: "--out",
      valueName: "PATH",
      schema: z
        .string()
        .optional()
        .describe("Output JSON path. Defaults to tmp/committee-sweeps/<timestamp>.json."),
    }),
    defineFlagOption({
      key: "telegram",
      long: "--telegram",
      schema: z
        .boolean()
        .default(false)
        .describe("Send concise Telegram checkpoint updates during the sweep."),
    }),
    defineValueOption({
      key: "telegramEvery",
      long: "--telegram-every",
      valueName: "N",
      schema: z.coerce
        .number()
        .int()
        .positive()
        .default(25)
        .describe(
          "When --telegram is set, send a progress update every N trials. Use 1 only for tiny debug sweeps.",
        ),
    }),
  ],
  examples: [
    "bun alea backtest:sweep-committee",
    "bun alea backtest:sweep-committee --max-runs 200 --telegram",
    "bun alea backtest:sweep-committee --mode focus --telegram",
    "bun alea backtest:sweep-committee --mode fine --telegram",
    "bun alea backtest:sweep-committee --mode ridge --telegram",
    "bun alea backtest:sweep-committee --mode macro",
    "bun alea backtest:sweep-committee --mode stacked",
  ],
  output:
    "Prints one line per trial plus the best current configuration. Writes JSON results.",
  sideEffects:
    "Reads candles and training artifacts. Writes a JSON artifact under tmp/. With --telegram, sends checkpoint Telegram updates. Does not mutate committee_selections or persist committee_backtest_runs.",
  async run({ io, options }) {
    const trials = buildSweepTrials({ mode: options.mode }).slice(
      0,
      options.maxRuns,
    );
    const outPath =
      options.out ??
      resolvePath(
        "tmp",
        "committee-sweeps",
        `${new Date().toISOString().replaceAll(":", "-")}.json`,
      );
    const telegram = createTelegramSender({
      enabled: options.telegram,
      io,
    });
    const db = createDatabase();
    const statsCache = new Map<number, readonly CandidateRegimeStats[]>();
    const results: SweepResult[] = [];
    let best: SweepResult | null = null;

    io.writeStdout(
      `${pc.bold("backtest:sweep-committee")} ${pc.dim(`trials=${trials.length} out=${outPath}`)}\n\n`,
    );

    try {
      for (let i = 0; i < trials.length; i += 1) {
        const trial = trials[i]!;
        const stats = await loadStatsForRules({
          db,
          rules: trial.selectionRules,
          statsCache,
        });
        const selections = selectCommitteeCandidates({
          stats,
          rules: trial.selectionRules,
        });
        const roster = buildCommitteeRosterFromSelections({ selections });
        const summary = await runCommitteeBacktest({
          db,
          roster,
          decisionRules: trial.decisionRules,
        });
        const result = summarizeSweepResult({
          trial,
          selectedCandidates: selections.length,
          summary,
          minScoredTrades: options.minScoredTrades,
        });
        results.push(result);
        if (isBetterResult({ candidate: result, incumbent: best })) {
          best = result;
        }
        await writeSweepArtifact({ outPath, results });

        io.writeStdout(
          `${String(i + 1).padStart(3)}/${trials.length} ${pc.bold(trial.id)} ` +
            `${formatWr(result.winRate)} wr ` +
            `${result.scoredTrades.toLocaleString()} scored ` +
            `${formatPercentOrDash(result.tradeRate)} trade-rate ` +
            `${pc.dim(`score=${result.score.toFixed(3)}`)} ` +
            `${best === result ? pc.green("new best") : pc.dim(`best=${best?.trial.id ?? "-"}`)}\n`,
        );
        if (
          shouldSendTelegramUpdate({
            index: i + 1,
            total: trials.length,
            every: options.telegramEvery,
            isNewBest: best === result,
          })
        ) {
          await telegram(
            formatTelegramUpdate({
              index: i + 1,
              total: trials.length,
              result,
              best: best ?? result,
            }),
          );
        }
      }
    } finally {
      await destroyDatabase(db);
    }

    const ordered = [...results].sort(compareSweepResults);
    io.writeStdout(`\n${pc.green("wrote")} ${outPath}\n`);
    io.writeStdout(`${pc.bold("top results")}\n`);
    for (const result of ordered.slice(0, 10)) {
      io.writeStdout(
        `  ${result.trial.id.padEnd(18)} ${formatWr(result.winRate).padStart(6)} ` +
          `${String(result.scoredTrades).padStart(6)} scored ` +
          `${formatPercentOrDash(result.tradeRate).padStart(6)} trade-rate ` +
          `${pc.dim(result.trial.hypothesis)}\n`,
      );
    }
  },
});

function buildSweepTrials({
  mode,
}: {
  readonly mode:
    | "broad"
    | "focus"
    | "fine"
    | "ridge"
    | "macro"
    | "stacked";
}): readonly SweepTrial[] {
  if (mode === "stacked") {
    return buildStackedMacroSweepTrials();
  }
  if (mode === "macro") {
    return buildMacroSweepTrials();
  }
  if (mode === "ridge") {
    return buildRidgeSweepTrials();
  }
  if (mode === "fine") {
    return buildFineSweepTrials();
  }
  if (mode === "focus") {
    return buildFocusedSweepTrials();
  }
  return buildBroadSweepTrials();
}

function buildBroadSweepTrials(): readonly SweepTrial[] {
  const selection = DEFAULT_COMMITTEE_SELECTION_RULES;
  const decision = DEFAULT_COMMITTEE_DECISION_RULES;
  const out: SweepTrial[] = [];
  const add = ({
    id,
    hypothesis,
    selectionRules = selection,
    decisionRules = decision,
  }: {
    readonly id: string;
    readonly hypothesis: string;
    readonly selectionRules?: CommitteeSelectionRules;
    readonly decisionRules?: CommitteeDecisionRules;
  }) => {
    const trial = { id, hypothesis, selectionRules, decisionRules };
    if (!out.some((existing) => sameTrial(existing, trial))) {
      out.push(trial);
    }
  };

  add({ id: "baseline", hypothesis: "current production-style committee" });

  for (const minVotesToTrade of [1, 2, 3, 4]) {
    for (const minConsensusFraction of [0.5, 0.55, 0.6, 0.67, 0.75]) {
      add({
        id: `votes${minVotesToTrade}-cons${pctId(minConsensusFraction)}`,
        hypothesis: "require more committee agreement before trading",
        decisionRules: {
          ...decision,
          minVotesToTrade,
          minConsensusFraction,
        },
      });
    }
  }

  for (const minEngagements of [10, 20, 40, 80]) {
    add({
      id: `eng${minEngagements}`,
      hypothesis: "change how much history a candidate needs before selection",
      selectionRules: { ...selection, minEngagements },
    });
  }
  for (const minAggregateWinRate of [0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.58]) {
    add({
      id: `agg${pctId(minAggregateWinRate)}`,
      hypothesis: "change the overall win-rate floor for committee entry",
      selectionRules: { ...selection, minAggregateWinRate },
    });
  }
  for (const minWorstQuarterWinRate of [0.48, 0.5, 0.52, 0.54]) {
    add({
      id: `worstq${pctId(minWorstQuarterWinRate)}`,
      hypothesis: "change the stability floor across meaningful quarters",
      selectionRules: { ...selection, minWorstQuarterWinRate },
    });
  }
  for (const worstQuarterMinEngagements of [5, 10, 20, 40]) {
    add({
      id: `qmin${worstQuarterMinEngagements}`,
      hypothesis: "change when a quarter is large enough to judge stability",
      selectionRules: { ...selection, worstQuarterMinEngagements },
    });
  }
  for (const topN of [5, 10, 15, 20, 30, 40]) {
    add({
      id: `top${topN}`,
      hypothesis: "change roster breadth per regime/timeframe bucket",
      selectionRules: { ...selection, topN },
    });
  }

  for (const minAggregateWinRate of [0.52, 0.53, 0.54, 0.55, 0.56]) {
    for (const minEngagements of [10, 20, 40]) {
      for (const topN of [10, 20, 30]) {
        for (const minVotesToTrade of [1, 2]) {
          for (const minConsensusFraction of [0.5, 0.6]) {
            add({
              id: [
                `agg${pctId(minAggregateWinRate)}`,
                `eng${minEngagements}`,
                `top${topN}`,
                `v${minVotesToTrade}`,
                `c${pctId(minConsensusFraction)}`,
              ].join("-"),
              hypothesis:
                "cross selection strictness with trade confirmation depth",
              selectionRules: {
                ...selection,
                minAggregateWinRate,
                minEngagements,
                topN,
              },
              decisionRules: {
                ...decision,
                minVotesToTrade,
                minConsensusFraction,
              },
            });
          }
        }
      }
    }
  }

  return out;
}

function buildFocusedSweepTrials(): readonly SweepTrial[] {
  const selection = DEFAULT_COMMITTEE_SELECTION_RULES;
  const decision = DEFAULT_COMMITTEE_DECISION_RULES;
  const out: SweepTrial[] = [];
  const add = ({
    minAggregateWinRate,
    minEngagements,
    topN,
    minVotesToTrade,
  }: {
    readonly minAggregateWinRate: number;
    readonly minEngagements: number;
    readonly topN: number;
    readonly minVotesToTrade: number;
  }) => {
    out.push({
      id: [
        `agg${pctId(minAggregateWinRate)}`,
        `eng${minEngagements}`,
        `top${topN}`,
        `v${minVotesToTrade}`,
      ].join("-"),
      hypothesis:
        "focused ridge search around the broad-pass WR/trade-rate cluster",
      selectionRules: {
        ...selection,
        minAggregateWinRate,
        minEngagements,
        topN,
      },
      decisionRules: {
        ...decision,
        minVotesToTrade,
        minConsensusFraction: 0.5,
      },
    });
  };

  for (const minAggregateWinRate of [0.525, 0.53, 0.535, 0.54, 0.545]) {
    for (const minEngagements of [10, 20, 40, 80]) {
      for (const topN of [8, 10, 12, 15, 18, 20, 25]) {
        for (const minVotesToTrade of [2, 3]) {
          add({
            minAggregateWinRate,
            minEngagements,
            topN,
            minVotesToTrade,
          });
        }
      }
    }
  }

  return out;
}

function buildFineSweepTrials(): readonly SweepTrial[] {
  const selection = DEFAULT_COMMITTEE_SELECTION_RULES;
  const decision = DEFAULT_COMMITTEE_DECISION_RULES;
  const out: SweepTrial[] = [];
  for (const minAggregateWinRate of [0.52, 0.525, 0.53, 0.535, 0.54]) {
    for (const minEngagements of [20, 80]) {
      for (const minWorstQuarterWinRate of [0.48, 0.5, 0.52]) {
        for (const topN of [11, 12, 13, 14, 15, 16, 18, 20, 25]) {
          for (const minVotesToTrade of [2, 3]) {
            out.push({
              id: [
                `agg${pctId(minAggregateWinRate)}`,
                `eng${minEngagements}`,
                `wq${pctId(minWorstQuarterWinRate)}`,
                `top${topN}`,
                `v${minVotesToTrade}`,
              ].join("-"),
              hypothesis:
                "fine ridge search for stable WR with more usable trade volume",
              selectionRules: {
                ...selection,
                minAggregateWinRate,
                minEngagements,
                minWorstQuarterWinRate,
                topN,
              },
              decisionRules: {
                ...decision,
                minVotesToTrade,
                minConsensusFraction: 0.5,
              },
            });
          }
        }
      }
    }
  }
  return out;
}

function buildRidgeSweepTrials(): readonly SweepTrial[] {
  const selection = DEFAULT_COMMITTEE_SELECTION_RULES;
  const decision = DEFAULT_COMMITTEE_DECISION_RULES;
  const out: SweepTrial[] = [];
  const add = ({
    minAggregateWinRate,
    minEngagements,
    minWorstQuarterWinRate,
    topN,
    minVotesToTrade = 2,
    hypothesis,
  }: {
    readonly minAggregateWinRate: number;
    readonly minEngagements: number;
    readonly minWorstQuarterWinRate: number;
    readonly topN: number;
    readonly minVotesToTrade?: number;
    readonly hypothesis: string;
  }) => {
    const trial = {
      id: [
        `agg${pctId(minAggregateWinRate)}`,
        `eng${minEngagements}`,
        `wq${pctId(minWorstQuarterWinRate)}`,
        `top${topN}`,
        `v${minVotesToTrade}`,
      ].join("-"),
      hypothesis,
      selectionRules: {
        ...selection,
        minAggregateWinRate,
        minEngagements,
        minWorstQuarterWinRate,
        topN,
      },
      decisionRules: {
        ...decision,
        minVotesToTrade,
        minConsensusFraction: 0.5,
      },
    };
    if (!out.some((existing) => sameTrial(existing, trial))) {
      out.push(trial);
    }
  };

  for (const minAggregateWinRate of [0.538, 0.54, 0.542, 0.545]) {
    for (const minEngagements of [20, 80]) {
      for (const minWorstQuarterWinRate of [0.5, 0.51, 0.52, 0.53]) {
        for (const topN of [13, 14, 15, 16, 17, 18, 19, 20]) {
          add({
            minAggregateWinRate,
            minEngagements,
            minWorstQuarterWinRate,
            topN,
            hypothesis:
              "strict stability ridge: preserve the 57% cluster while testing roster breadth",
          });
        }
      }
    }
  }

  for (const minAggregateWinRate of [0.52, 0.525, 0.53, 0.535, 0.54]) {
    for (const minEngagements of [20, 80]) {
      for (const minWorstQuarterWinRate of [0.46, 0.47, 0.48, 0.49, 0.5]) {
        for (const topN of [14, 15, 16, 17, 18, 19, 20]) {
          add({
            minAggregateWinRate,
            minEngagements,
            minWorstQuarterWinRate,
            topN,
            hypothesis:
              "volume ridge: test whether a looser stability floor buys enough extra trades",
          });
        }
      }
    }
  }

  return out;
}

function buildMacroSweepTrials(): readonly SweepTrial[] {
  const selection = DEFAULT_COMMITTEE_SELECTION_RULES;
  const decision = DEFAULT_COMMITTEE_DECISION_RULES;
  const out: SweepTrial[] = [];
  const add = ({
    id,
    hypothesis,
    selectionRules = selection,
    decisionRules = decision,
  }: {
    readonly id: string;
    readonly hypothesis: string;
    readonly selectionRules?: CommitteeSelectionRules;
    readonly decisionRules?: CommitteeDecisionRules;
  }) => {
    const trial = { id, hypothesis, selectionRules, decisionRules };
    if (!out.some((existing) => sameTrial(existing, trial))) {
      out.push(trial);
    }
  };

  add({
    id: "baseline",
    hypothesis: "current production-style committee anchor",
  });

  for (const minVotesToTrade of [2, 3, 4, 5, 6, 8, 10]) {
    for (const minConsensusFraction of [0.5, 0.8, 1]) {
      add({
        id: `current-v${minVotesToTrade}-c${pctId(minConsensusFraction)}`,
        hypothesis:
          "macro vote stress: require far more committee participation or agreement",
        decisionRules: {
          ...decision,
          minVotesToTrade,
          minConsensusFraction,
        },
      });
    }
  }

  for (const minAggregateWinRate of [0.56, 0.58, 0.6, 0.62, 0.65]) {
    for (const topN of [10, 40]) {
      for (const minVotesToTrade of [1, 2]) {
        add({
          id: [
            `strict-agg${pctId(minAggregateWinRate)}`,
            `top${topN}`,
            `v${minVotesToTrade}`,
          ].join("-"),
          hypothesis:
            "macro quality stress: only allow very high historical WR candidates",
          selectionRules: {
            ...selection,
            minAggregateWinRate,
            minWorstQuarterWinRate: 0.5,
            topN,
          },
          decisionRules: {
            ...decision,
            minVotesToTrade,
            minConsensusFraction: 0.5,
          },
        });
      }
    }
  }

  for (const minAggregateWinRate of [0.48, 0.52]) {
    for (const topN of [40, 80]) {
      for (const minVotesToTrade of [4, 8, 10]) {
        for (const minConsensusFraction of [0.5, 1]) {
          add({
            id: [
              `wide-agg${pctId(minAggregateWinRate)}`,
              `top${topN}`,
              `v${minVotesToTrade}`,
              `c${pctId(minConsensusFraction)}`,
            ].join("-"),
            hypothesis:
              "macro breadth stress: broad roster plus high vote quorum",
            selectionRules: {
              ...selection,
              minAggregateWinRate,
              minWorstQuarterWinRate: 0.46,
              topN,
            },
            decisionRules: {
              ...decision,
              minVotesToTrade,
              minConsensusFraction,
            },
          });
        }
      }
    }
  }

  return out;
}

function buildStackedMacroSweepTrials(): readonly SweepTrial[] {
  const selection = DEFAULT_COMMITTEE_SELECTION_RULES;
  const decision = DEFAULT_COMMITTEE_DECISION_RULES;
  const out: SweepTrial[] = [];
  const add = ({
    id,
    selectionRules,
    decisionRules,
    hypothesis,
  }: {
    readonly id: string;
    readonly selectionRules: CommitteeSelectionRules;
    readonly decisionRules: CommitteeDecisionRules;
    readonly hypothesis: string;
  }) => {
    const trial = { id, hypothesis, selectionRules, decisionRules };
    if (!out.some((existing) => sameTrial(existing, trial))) {
      out.push(trial);
    }
  };

  const selectionFamilies = [
    {
      label: "strict",
      hypothesis:
        "stack strict candidate quality with high vote quorum to test whether the big WR move compounds",
      minAggregateWinRate: 0.54,
      minWorstQuarterWinRate: 0.52,
      topNs: [16, 18],
    },
    {
      label: "middle",
      hypothesis:
        "stack middle-volume candidate quality with high vote quorum to preserve more trade count",
      minAggregateWinRate: 0.538,
      minWorstQuarterWinRate: 0.52,
      topNs: [17, 18],
    },
    {
      label: "volume",
      hypothesis:
        "stack high-volume candidate quality with high vote quorum to see if breadth is salvageable",
      minAggregateWinRate: 0.52,
      minWorstQuarterWinRate: 0.46,
      topNs: [15, 40],
    },
  ] as const;

  for (const family of selectionFamilies) {
    for (const topN of family.topNs) {
      for (const minVotesToTrade of [2, 5, 6, 8, 10]) {
        for (const minConsensusFraction of [0.5, 1]) {
          add({
            id: [
              family.label,
              `agg${pctId(family.minAggregateWinRate)}`,
              `wq${pctId(family.minWorstQuarterWinRate)}`,
              `top${topN}`,
              `v${minVotesToTrade}`,
              `c${pctId(minConsensusFraction)}`,
            ].join("-"),
            hypothesis: family.hypothesis,
            selectionRules: {
              ...selection,
              minAggregateWinRate: family.minAggregateWinRate,
              minWorstQuarterWinRate: family.minWorstQuarterWinRate,
              topN,
            },
            decisionRules: {
              ...decision,
              minVotesToTrade,
              minConsensusFraction,
            },
          });
        }
      }
    }
  }

  return out;
}

async function loadStatsForRules({
  db,
  rules,
  statsCache,
}: {
  readonly db: ReturnType<typeof createDatabase>;
  readonly rules: CommitteeSelectionRules;
  readonly statsCache: Map<number, readonly CandidateRegimeStats[]>;
}): Promise<readonly CandidateRegimeStats[]> {
  const key = rules.worstQuarterMinEngagements;
  const cached = statsCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const stats = await loadCandidateRegimeStats({
    db,
    worstQuarterMinEngagements: key,
  });
  statsCache.set(key, stats);
  return stats;
}

function summarizeSweepResult({
  trial,
  selectedCandidates,
  summary,
  minScoredTrades,
}: {
  readonly trial: SweepTrial;
  readonly selectedCandidates: number;
  readonly summary: Awaited<ReturnType<typeof runCommitteeBacktest>>;
  readonly minScoredTrades: number;
}): SweepResult {
  const totals = summary.totals;
  const wilson =
    totals.scoredTrades === 0
      ? null
      : wilsonInterval95({ wins: totals.wins, n: totals.scoredTrades });
  const positiveDays = summary.equityCurve.filter((p) => p.pnlUsd > 0).length;
  const days = summary.equityCurve.length;
  const passesHardFilters =
    totals.scoredTrades >= minScoredTrades &&
    totals.pnlUsd > 0 &&
    totals.winRate !== null &&
    totals.winRate > 0.5 &&
    days > 0 &&
    positiveDays / days >= 0.5;
  const score =
    wilson === null
      ? Number.NEGATIVE_INFINITY
      : (wilson.low - 0.5) * Math.sqrt(Math.min(totals.scoredTrades, 5_000));
  return {
    trial,
    selectedCandidates,
    score,
    passesHardFilters,
    winRate: totals.winRate,
    wilsonLow: wilson?.low ?? null,
    scoredTrades: totals.scoredTrades,
    tradeRate: totals.tradeRate,
    positiveDayRate: days === 0 ? null : positiveDays / days,
    pnlUsd: totals.pnlUsd,
    byPeriod: summary.byPeriod.map((row) => ({
      label: row.label,
      winRate: row.winRate,
      scoredTrades: row.scoredTrades,
      tradeRate: row.tradeRate,
    })),
  };
}

function compareSweepResults(a: SweepResult, b: SweepResult): number {
  if (a.passesHardFilters !== b.passesHardFilters) {
    return a.passesHardFilters ? -1 : 1;
  }
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  return (b.winRate ?? 0) - (a.winRate ?? 0);
}

function isBetterResult({
  candidate,
  incumbent,
}: {
  readonly candidate: SweepResult;
  readonly incumbent: SweepResult | null;
}): boolean {
  if (incumbent === null) {
    return true;
  }
  return compareSweepResults(candidate, incumbent) < 0;
}

async function writeSweepArtifact({
  outPath,
  results,
}: {
  readonly outPath: string;
  readonly results: readonly SweepResult[];
}): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    `${JSON.stringify(
      {
        generatedAtMs: Date.now(),
        objective:
          "(wilsonLower95(winRate, scoredTrades) - 0.50) * sqrt(min(scoredTrades, 5000))",
        results: [...results].sort(compareSweepResults),
      },
      null,
      2,
    )}\n`,
  );
}

function createTelegramSender({
  enabled,
  io,
}: {
  readonly enabled: boolean;
  readonly io: { writeStderr: (text: string) => void };
}): (text: string) => Promise<void> {
  if (!enabled) {
    return async () => {};
  }
  const botToken = env.telegramBotToken;
  const chatId = env.telegramChatId;
  if (botToken === undefined || chatId === undefined) {
    throw new Error(
      "--telegram requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.",
    );
  }
  return async (text: string) => {
    try {
      await sendTelegramMessage({ botToken, chatId, text });
    } catch (error) {
      io.writeStderr(
        `${pc.yellow("telegram update failed:")} ${(error as Error).message}\n`,
      );
    }
  };
}

function formatTelegramUpdate({
  index,
  total,
  result,
  best,
}: {
  readonly index: number;
  readonly total: number;
  readonly result: SweepResult;
  readonly best: SweepResult;
}): string {
  const periods = result.byPeriod
    .map((row) => `${row.label} ${formatWr(row.winRate)}`)
    .join(", ");
  const bestText =
    best === result
      ? "New best so far."
      : `Best remains ${best.trial.id}: ${formatWr(best.winRate)} on ${best.scoredTrades.toLocaleString()} trades.`;
  return [
    `shittenheimer sweep ${index}/${total}: ${result.trial.hypothesis}.`,
    `This run: ${formatWr(result.winRate)} on ${result.scoredTrades.toLocaleString()} trades, trade rate ${formatPercentOrDash(result.tradeRate)}.`,
    `By period: ${periods}.`,
    bestText,
  ].join(" ");
}

function shouldSendTelegramUpdate({
  index,
  total,
  every,
  isNewBest,
}: {
  readonly index: number;
  readonly total: number;
  readonly every: number;
  readonly isNewBest: boolean;
}): boolean {
  return index === 1 || index === total || index % every === 0 || isNewBest;
}

function sameTrial(a: SweepTrial, b: SweepTrial): boolean {
  return (
    JSON.stringify(a.selectionRules) === JSON.stringify(b.selectionRules) &&
    JSON.stringify(a.decisionRules) === JSON.stringify(b.decisionRules)
  );
}

function pctId(value: number): string {
  const pct = value * 100;
  return (Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)).replace(
    ".",
    "p",
  );
}

function formatWr(value: number | null): string {
  return value === null ? "-" : `${(value * 100).toFixed(2)}%`;
}

function formatPercentOrDash(value: number | null): string {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}
