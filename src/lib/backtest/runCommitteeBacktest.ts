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
  MAX_COMMITTEE_VOTES_PER_FILTER,
  MIN_COMMITTEE_CONSENSUS_FRACTION,
  MIN_COMMITTEE_VOTES_TO_TRADE,
  TRADE_DECISION_DEFAULT_PERIODS,
  TRADE_DECISION_HYDRATE_BARS,
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
import type { FilterBar } from "@alea/lib/filters/types";
import { classifyMarketRegime } from "@alea/lib/regime/classify";
import type { MarketRegime } from "@alea/lib/regime/types";
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

type LoadedBars = {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly bars: readonly FilterBar[];
};

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
  startedAtMs = Date.now(),
  now = () => Date.now(),
}: {
  readonly db: DatabaseClient;
  readonly startedAtMs?: number;
  readonly now?: () => number;
}): Promise<CommitteeBacktestSummary> {
  const windowEndExclusiveMs = resolveBacktestWindowEndExclusiveMs({
    nowMs: startedAtMs,
  });
  const roster = await loadCommitteeRoster({ db });
  const rosterCandidatesByBucket = buildRosterCandidatesByBucket({ roster });
  const loaded = await loadBacktestBars({ db, windowEndExclusiveMs });
  const acc = createAccumulator();

  for (const series of loaded) {
    replaySeries({
      series,
      windowEndExclusiveMs,
      rosterCandidatesByBucket,
      acc,
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
      maxVotesPerFilter: MAX_COMMITTEE_VOTES_PER_FILTER,
      minVotesToTrade: MIN_COMMITTEE_VOTES_TO_TRADE,
      minConsensusFraction: MIN_COMMITTEE_CONSENSUS_FRACTION,
    },
    roster: {
      selectedAtMs: roster.selectedAtMs,
      bucketCount: roster.byBucket.size,
      candidateCount: [...roster.byBucket.values()].reduce(
        (sum, list) => sum + list.length,
        0,
      ),
    },
    totals: finalizeBucket(acc.total),
    byPeriod: finalizeBuckets(acc.byPeriod),
    byAsset: finalizeBuckets(acc.byAsset),
    byRegime: finalizeBuckets(acc.byRegime),
    byPeriodAsset: finalizeBuckets(acc.byPeriodAsset),
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
      const rows = await db
        .selectFrom("candles")
        .select(["timestamp", "open", "high", "low", "close", "volume"])
        .where("source", "=", "pyth")
        .where("product", "=", "spot")
        .where("asset", "=", asset)
        .where("timeframe", "=", period)
        .where("timestamp", ">=", new Date(BACKTEST_WINDOW_START_MS - warmupMs))
        .where("timestamp", "<", new Date(windowEndExclusiveMs))
        .orderBy("timestamp", "asc")
        .execute();
      loaded.push({
        asset,
        period,
        bars: rows.map((r) => ({
          openTimeMs:
            r.timestamp instanceof Date
              ? r.timestamp.getTime()
              : new Date(r.timestamp).getTime(),
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
          volume: r.volume,
        })),
      });
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
}: {
  readonly series: LoadedBars;
  readonly windowEndExclusiveMs: number;
  readonly rosterCandidatesByBucket: ReadonlyMap<
    string,
    readonly CommitteeCandidate[]
  >;
  readonly acc: ReturnType<typeof createAccumulator>;
}): void {
  for (let i = 0; i < series.bars.length - 1; i += 1) {
    const target = series.bars[i + 1]!;
    if (target.openTimeMs < BACKTEST_WINDOW_START_MS) {
      continue;
    }
    if (target.openTimeMs >= windowEndExclusiveMs) {
      break;
    }

    const buckets = bucketsForDecision({
      acc,
      asset: series.asset,
      period: series.period,
      marketRegime: null,
    });
    increment(buckets, "decisionMoments");

    const window = series.bars.slice(
      Math.max(0, i - TRADE_DECISION_HYDRATE_BARS + 1),
      i + 1,
    );
    const marketRegime = classifyMarketRegime({ bars: window });
    if (marketRegime === null) {
      increment(buckets, "noRegimeMoments");
      continue;
    }

    const regimeBucket = getBucket(acc.byRegime, marketRegime, marketRegime);
    regimeBucket.decisionMoments += 1;
    const regimeBuckets = [...buckets, regimeBucket];
    const bucket = rosterBucketKey({ marketRegime, period: series.period });
    const candidates = rosterCandidatesByBucket.get(bucket);
    if (candidates === undefined || candidates.length === 0) {
      increment(regimeBuckets, "emptyRosterMoments");
      continue;
    }

    const { decision } = evaluateCommittee({ bars: window, candidates });
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
    if (decision.prediction === actual) {
      increment(regimeBuckets, "wins");
    } else {
      increment(regimeBuckets, "losses");
    }
  }
}

function createAccumulator(): {
  readonly total: MutableBucket;
  readonly byPeriod: Map<string, MutableBucket>;
  readonly byAsset: Map<string, MutableBucket>;
  readonly byRegime: Map<string, MutableBucket>;
  readonly byPeriodAsset: Map<string, MutableBucket>;
} {
  return {
    total: mutableBucket({ key: "all", label: "All" }),
    byPeriod: new Map(),
    byAsset: new Map(),
    byRegime: new Map(),
    byPeriodAsset: new Map(),
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
    getBucket(acc.byPeriodAsset, `${period}|${asset}`, `${period} ${asset.toUpperCase()}`),
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
