import "@alea/lib/filters/all";

import { assetValues } from "@alea/constants/assets";
import {
  COMMITTEE_BACKTEST_PROFILE_ID,
  COMMITTEE_BACKTEST_SCHEMA_VERSION,
} from "@alea/constants/backtest";
import {
  BACKTEST_WINDOW_START_MS,
  resolveBacktestWindowEndExclusiveMs,
} from "@alea/constants/researchWindows";
import {
  type CommitteeDecisionRules,
  DEFAULT_COMMITTEE_DECISION_RULES,
  TRADE_DECISION_DEFAULT_PERIODS,
  TRADE_DECISION_HYDRATE_BARS,
  TRADE_DECISION_LEAD_TIME_BY_PERIOD_MS,
  type TradeDecisionPeriod,
} from "@alea/constants/tradeDecision";
import { STAKE_USD } from "@alea/constants/trading";
import { TRAINING_PROFILE_ID } from "@alea/constants/training";
import { evaluateCommittee } from "@alea/lib/committee/runCommittee";
import {
  candidateRosterKey,
  type CommitteeRoster,
  loadCommitteeRoster,
  rosterBucketKey,
} from "@alea/lib/committee/selection/loadCommitteeRoster";
import type { CommitteeCandidate } from "@alea/lib/committee/types";
import type { DatabaseClient } from "@alea/lib/db/types";
import { allCandidates } from "@alea/lib/filters/registry";
import { classifyMarketRegime } from "@alea/lib/regime/classify";
import type { MarketRegime } from "@alea/lib/regime/types";
import {
  buildHistoricalDecisionMoment,
  type HistoricalDecisionSeries,
  loadHistoricalDecisionSeries,
} from "@alea/lib/tradeDecision/historicalDecisionSeries";
import { resolveTrainingOutcomeDirection } from "@alea/lib/training/resolveTrainingOutcomeDirection";
import type { Asset } from "@alea/types/assets";

type BacktestBucket = {
  readonly key: string;
  readonly label: string;
  readonly decisionMoments: number;
  readonly committeeDecisions: number;
  readonly scoredTrades: number;
  readonly wins: number;
  readonly losses: number;
  readonly ambiguousTrades: number;
  readonly noRegimeMoments: number;
  readonly emptyRosterMoments: number;
  readonly abstainMoments: number;
  readonly winRate: number | null;
  readonly tradeRate: number | null;
  readonly pnlUsd: number;
};

export type BacktestEquityPoint = {
  readonly date: string;
  readonly timestampMs: number;
  readonly scoredTrades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number | null;
  readonly pnlUsd: number;
  readonly cumulativePnlUsd: number;
};

export type CommitteeBacktestSummary = {
  readonly schemaVersion: number;
  readonly runProfile: string;
  readonly trainingProfile: string;
  readonly generatedAtMs: number;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly durationMs: number;
  readonly windowStartMs: number;
  readonly windowEndExclusiveMs: number;
  readonly stakeUsd: number;
  readonly periods: readonly TradeDecisionPeriod[];
  readonly assets: readonly Asset[];
  readonly tradeDecisionConfig: {
    readonly hydrateBars: number;
    readonly leadTimeByPeriodMs: Readonly<Record<TradeDecisionPeriod, number>>;
    readonly maxVotesPerFilter: number;
    readonly minVotesToTrade: number;
    readonly minConsensusFraction: number;
  };
  readonly roster: {
    readonly selectedAtMs: number | null;
    readonly bucketCount: number;
    readonly candidateCount: number;
  };
  readonly totals: BacktestBucket;
  readonly byPeriod: readonly BacktestBucket[];
  readonly byAsset: readonly BacktestBucket[];
  readonly byRegime: readonly BacktestBucket[];
  readonly byPeriodAsset: readonly BacktestBucket[];
  readonly equityCurve: readonly BacktestEquityPoint[];
};

type MutableBucket = {
  key: string;
  label: string;
  decisionMoments: number;
  committeeDecisions: number;
  scoredTrades: number;
  wins: number;
  losses: number;
  ambiguousTrades: number;
  noRegimeMoments: number;
  emptyRosterMoments: number;
  abstainMoments: number;
};

type MutableEquityPoint = {
  date: string;
  timestampMs: number;
  scoredTrades: number;
  wins: number;
  losses: number;
  pnlUsd: number;
};

type LoadedBars = {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly series: HistoricalDecisionSeries;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const periodMs: Record<TradeDecisionPeriod, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
};

export async function runAndPersistCommitteeBacktest({
  db,
  now = () => Date.now(),
}: {
  readonly db: DatabaseClient;
  readonly now?: () => number;
}): Promise<CommitteeBacktestSummary & { readonly id: string }> {
  const startedAtMs = now();
  const summary = await runCommitteeBacktest({ db, startedAtMs, now });
  const inserted = await db
    .insertInto("committee_backtest_runs")
    .values({
      run_profile: summary.runProfile,
      training_profile: summary.trainingProfile,
      selected_at_ms: summary.roster.selectedAtMs,
      window_start_ms: summary.windowStartMs,
      window_end_exclusive_ms: summary.windowEndExclusiveMs,
      started_at_ms: summary.startedAtMs,
      completed_at_ms: summary.completedAtMs,
      duration_ms: summary.durationMs,
      summary_json: summary,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { ...summary, id: String(inserted.id) };
}

export async function runCommitteeBacktest({
  db,
  roster,
  decisionRules = DEFAULT_COMMITTEE_DECISION_RULES,
  startedAtMs = Date.now(),
  now = () => Date.now(),
}: {
  readonly db: DatabaseClient;
  readonly roster?: CommitteeRoster;
  readonly decisionRules?: CommitteeDecisionRules;
  readonly startedAtMs?: number;
  readonly now?: () => number;
}): Promise<CommitteeBacktestSummary> {
  const windowEndExclusiveMs = resolveBacktestWindowEndExclusiveMs({
    nowMs: startedAtMs,
  });
  const activeRoster = roster ?? (await loadCommitteeRoster({ db }));
  const rosterCandidatesByBucket = buildRosterCandidatesByBucket({
    roster: activeRoster,
  });
  const loaded = await loadBacktestBars({ db, windowEndExclusiveMs });
  const acc = createAccumulator();

  for (const series of loaded) {
    replaySeries({
      series,
      windowEndExclusiveMs,
      rosterCandidatesByBucket,
      acc,
      decisionRules,
    });
  }

  const completedAtMs = now();
  return {
    schemaVersion: COMMITTEE_BACKTEST_SCHEMA_VERSION,
    runProfile: COMMITTEE_BACKTEST_PROFILE_ID,
    trainingProfile: TRAINING_PROFILE_ID,
    generatedAtMs: completedAtMs,
    startedAtMs,
    completedAtMs,
    durationMs: Math.max(0, completedAtMs - startedAtMs),
    windowStartMs: BACKTEST_WINDOW_START_MS,
    windowEndExclusiveMs,
    stakeUsd: STAKE_USD,
    periods: TRADE_DECISION_DEFAULT_PERIODS,
    assets: assetValues,
    tradeDecisionConfig: {
      hydrateBars: TRADE_DECISION_HYDRATE_BARS,
      leadTimeByPeriodMs: TRADE_DECISION_LEAD_TIME_BY_PERIOD_MS,
      maxVotesPerFilter: decisionRules.maxVotesPerFilter,
      minVotesToTrade: decisionRules.minVotesToTrade,
      minConsensusFraction: decisionRules.minConsensusFraction,
    },
    roster: {
      selectedAtMs: activeRoster.selectedAtMs,
      bucketCount: activeRoster.byBucket.size,
      candidateCount: [...activeRoster.byBucket.values()].reduce(
        (sum, list) => sum + list.length,
        0,
      ),
    },
    totals: finalizeBucket(acc.total),
    byPeriod: finalizeBuckets(acc.byPeriod),
    byAsset: finalizeBuckets(acc.byAsset),
    byRegime: finalizeBuckets(acc.byRegime),
    byPeriodAsset: finalizeBuckets(acc.byPeriodAsset),
    equityCurve: finalizeEquityCurve({
      byDay: acc.equityByDay,
      windowStartMs: BACKTEST_WINDOW_START_MS,
      windowEndExclusiveMs,
    }),
  };
}

async function loadBacktestBars({
  db,
  windowEndExclusiveMs,
}: {
  readonly db: DatabaseClient;
  readonly windowEndExclusiveMs: number;
}): Promise<readonly LoadedBars[]> {
  const loaded: LoadedBars[] = [];
  for (const period of TRADE_DECISION_DEFAULT_PERIODS) {
    const warmupMs = TRADE_DECISION_HYDRATE_BARS * periodMs[period];
    for (const asset of assetValues) {
      const series = await loadHistoricalDecisionSeries({
        db,
        asset,
        period,
        windowStartMs: BACKTEST_WINDOW_START_MS - warmupMs,
        windowEndExclusiveMs,
      });
      loaded.push({ asset, period, series });
    }
  }
  return loaded;
}

function buildRosterCandidatesByBucket({
  roster,
}: {
  readonly roster: CommitteeRoster;
}): ReadonlyMap<string, readonly CommitteeCandidate[]> {
  const candidatesByKey = new Map(
    allCandidates().map((candidate) => [
      candidateRosterKey({
        filterId: candidate.filterId,
        filterVersion: candidate.version,
        configCanon: candidate.configCanon,
      }),
      candidate,
    ]),
  );
  const out = new Map<string, CommitteeCandidate[]>();
  for (const [bucket, members] of roster.byBucket) {
    const committeeCandidates: CommitteeCandidate[] = [];
    for (const member of members) {
      const candidate = candidatesByKey.get(member.key);
      if (candidate === undefined) {
        continue;
      }
      committeeCandidates.push({
        candidate,
        selection: {
          winRate: member.winRate,
          nEngagements: member.nEngagements,
          rank: member.rank,
        },
      });
    }
    out.set(bucket, committeeCandidates);
  }
  return out;
}

function replaySeries({
  series,
  windowEndExclusiveMs,
  rosterCandidatesByBucket,
  acc,
  decisionRules,
}: {
  readonly series: LoadedBars;
  readonly windowEndExclusiveMs: number;
  readonly rosterCandidatesByBucket: ReadonlyMap<
    string,
    readonly CommitteeCandidate[]
  >;
  readonly acc: ReturnType<typeof createAccumulator>;
  readonly decisionRules: CommitteeDecisionRules;
}): void {
  const pyth = series.series.periodSeries.pyth;
  for (let targetIndex = 1; targetIndex < pyth.length; targetIndex += 1) {
    const target = pyth[targetIndex]!;
    if (target.openTimeMs < BACKTEST_WINDOW_START_MS) {
      continue;
    }
    if (target.openTimeMs >= windowEndExclusiveMs) {
      break;
    }

    const decisionMoment = buildHistoricalDecisionMoment({
      series: series.series,
      targetIndex,
    });
    if (decisionMoment === null) {
      continue;
    }

    const buckets = bucketsForDecision({
      acc,
      asset: series.asset,
      period: series.period,
      marketRegime: null,
    });
    increment(buckets, "decisionMoments");

    const marketRegime = classifyMarketRegime({
      bars: decisionMoment.series.pyth,
    });
    if (marketRegime === null) {
      increment(buckets, "noRegimeMoments");
      continue;
    }

    const regimeBucket = getBucket(acc.byRegime, marketRegime, marketRegime);
    regimeBucket.decisionMoments += 1;
    const regimeBuckets = [...buckets, regimeBucket];
    const bucket = rosterBucketKey({
      asset: series.asset,
      marketRegime,
      period: series.period,
    });
    const candidates = rosterCandidatesByBucket.get(bucket);
    if (candidates === undefined || candidates.length === 0) {
      increment(regimeBuckets, "emptyRosterMoments");
      continue;
    }

    const { decision } = evaluateCommittee({
      series: decisionMoment.series,
      candidates,
      decisionRules,
    });
    if (decision.prediction === null) {
      increment(regimeBuckets, "abstainMoments");
      continue;
    }

    increment(regimeBuckets, "committeeDecisions");
    const actual = resolveTrainingOutcomeDirection({
      open: target.open,
      close: target.close,
    });
    if (actual === null) {
      increment(regimeBuckets, "ambiguousTrades");
      continue;
    }
    increment(regimeBuckets, "scoredTrades");
    const isWin = decision.prediction === actual;
    if (isWin) {
      increment(regimeBuckets, "wins");
    } else {
      increment(regimeBuckets, "losses");
    }
    recordEquityPoint({
      acc,
      isWin,
      timestampMs: target.openTimeMs,
    });
  }
}

function createAccumulator(): {
  readonly total: MutableBucket;
  readonly byPeriod: Map<string, MutableBucket>;
  readonly byAsset: Map<string, MutableBucket>;
  readonly byRegime: Map<string, MutableBucket>;
  readonly byPeriodAsset: Map<string, MutableBucket>;
  readonly equityByDay: Map<string, MutableEquityPoint>;
} {
  return {
    total: mutableBucket({ key: "all", label: "All" }),
    byPeriod: new Map(),
    byAsset: new Map(),
    byRegime: new Map(),
    byPeriodAsset: new Map(),
    equityByDay: new Map(),
  };
}

function bucketsForDecision({
  acc,
  asset,
  period,
  marketRegime,
}: {
  readonly acc: ReturnType<typeof createAccumulator>;
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly marketRegime: MarketRegime | null;
}): readonly MutableBucket[] {
  const buckets = [
    acc.total,
    getBucket(acc.byPeriod, period, period),
    getBucket(acc.byAsset, asset, asset.toUpperCase()),
    getBucket(
      acc.byPeriodAsset,
      `${period}|${asset}`,
      `${period} ${asset.toUpperCase()}`,
    ),
  ];
  if (marketRegime !== null) {
    buckets.push(getBucket(acc.byRegime, marketRegime, marketRegime));
  }
  return buckets;
}

function getBucket(
  map: Map<string, MutableBucket>,
  key: string,
  label: string,
): MutableBucket {
  let bucket = map.get(key);
  if (bucket === undefined) {
    bucket = mutableBucket({ key, label });
    map.set(key, bucket);
  }
  return bucket;
}

function mutableBucket({
  key,
  label,
}: {
  readonly key: string;
  readonly label: string;
}): MutableBucket {
  return {
    key,
    label,
    decisionMoments: 0,
    committeeDecisions: 0,
    scoredTrades: 0,
    wins: 0,
    losses: 0,
    ambiguousTrades: 0,
    noRegimeMoments: 0,
    emptyRosterMoments: 0,
    abstainMoments: 0,
  };
}

function increment(
  buckets: readonly MutableBucket[],
  key: Exclude<keyof MutableBucket, "key" | "label">,
): void {
  for (const bucket of buckets) {
    bucket[key] += 1;
  }
}

function recordEquityPoint({
  acc,
  isWin,
  timestampMs,
}: {
  readonly acc: ReturnType<typeof createAccumulator>;
  readonly isWin: boolean;
  readonly timestampMs: number;
}): void {
  const dayStartMs = utcDayStartMs({ ms: timestampMs });
  const date = dateKey({ dayStartMs });
  let point = acc.equityByDay.get(date);
  if (point === undefined) {
    point = {
      date,
      timestampMs: dayStartMs,
      scoredTrades: 0,
      wins: 0,
      losses: 0,
      pnlUsd: 0,
    };
    acc.equityByDay.set(date, point);
  }
  point.scoredTrades += 1;
  if (isWin) {
    point.wins += 1;
    point.pnlUsd += STAKE_USD;
  } else {
    point.losses += 1;
    point.pnlUsd -= STAKE_USD;
  }
}

function finalizeBuckets(
  map: ReadonlyMap<string, MutableBucket>,
): readonly BacktestBucket[] {
  return [...map.values()].map(finalizeBucket);
}

function finalizeBucket(bucket: MutableBucket): BacktestBucket {
  const scoredTrades = bucket.scoredTrades;
  const winRate = scoredTrades === 0 ? null : bucket.wins / scoredTrades;
  const tradeRate =
    bucket.decisionMoments === 0
      ? null
      : bucket.committeeDecisions / bucket.decisionMoments;
  return {
    ...bucket,
    winRate,
    tradeRate,
    pnlUsd: (bucket.wins - bucket.losses) * STAKE_USD,
  };
}

function finalizeEquityCurve({
  byDay,
  windowStartMs,
  windowEndExclusiveMs,
}: {
  readonly byDay: ReadonlyMap<string, MutableEquityPoint>;
  readonly windowStartMs: number;
  readonly windowEndExclusiveMs: number;
}): readonly BacktestEquityPoint[] {
  const out: BacktestEquityPoint[] = [];
  let cumulativePnlUsd = 0;
  const firstDayStartMs = utcDayStartMs({ ms: windowStartMs });
  for (
    let dayStartMs = firstDayStartMs;
    dayStartMs < windowEndExclusiveMs;
    dayStartMs += DAY_MS
  ) {
    const date = dateKey({ dayStartMs });
    const point = byDay.get(date) ?? {
      date,
      timestampMs: dayStartMs,
      scoredTrades: 0,
      wins: 0,
      losses: 0,
      pnlUsd: 0,
    };
    cumulativePnlUsd += point.pnlUsd;
    out.push({
      date,
      timestampMs: dayStartMs,
      scoredTrades: point.scoredTrades,
      wins: point.wins,
      losses: point.losses,
      winRate:
        point.scoredTrades === 0 ? null : point.wins / point.scoredTrades,
      pnlUsd: point.pnlUsd,
      cumulativePnlUsd,
    });
  }
  return out;
}

function utcDayStartMs({ ms }: { readonly ms: number }): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dateKey({ dayStartMs }: { readonly dayStartMs: number }): string {
  return new Date(dayStartMs).toISOString().slice(0, 10);
}
