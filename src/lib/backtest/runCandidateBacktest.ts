import {
  CANDIDATE_BACKTEST_ASSETS,
  CANDIDATE_BACKTEST_DECISION_SCHEMA_VERSION,
  CANDIDATE_BACKTEST_END_EXCLUSIVE_MS,
  CANDIDATE_BACKTEST_ENGINE_VERSION,
  CANDIDATE_BACKTEST_PERIODS,
  CANDIDATE_BACKTEST_START_MS,
} from "@alea/constants/backtest";
import {
  tradeDecisionFireTimeMs,
  tradeDecisionHydrateBars,
  tradeDecisionLeadTimeMs,
  type TradeDecisionPeriod,
} from "@alea/constants/tradeDecision";
import {
  candidateBacktestCacheHash,
  candidateBacktestInputDataHash,
  quarterLabelFor,
  quarterStartFor,
  quarterWindowFor,
} from "@alea/lib/backtest/cache";
import { timeframeMs } from "@alea/lib/candles/timeframeMs";
import type { DatabaseClient } from "@alea/lib/db/types";
import { registeredCandidatesForMarket } from "@alea/lib/filters/registry";
import type { FilterCandidate, FilterDecision } from "@alea/lib/filters/types";
import { alignMarketSeries } from "@alea/lib/marketSeries/align";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { resolveDirectionalOutcome } from "@alea/lib/reliability/resolveDirectionalOutcome";
import type { Asset } from "@alea/types/assets";
import { sql } from "kysely";

const ONE_MINUTE_MS = 60_000;

export type CandidateBacktestLogEvent =
  | {
      readonly kind: "market";
      readonly asset: Asset;
      readonly period: TradeDecisionPeriod;
      readonly candidateCount: number;
      readonly targetCount: number;
      readonly rowCount: number;
      readonly skippedRowCount: number;
    }
  | {
      readonly kind: "skip";
      readonly asset: Asset;
      readonly period: TradeDecisionPeriod;
      readonly reason: string;
    };

export type RunCandidateBacktestResult = {
  readonly rowsWritten: number;
  readonly rowsSkipped: number;
  readonly markets: number;
  readonly decisions: number;
};

export async function runCandidateBacktest({
  db,
  assets = CANDIDATE_BACKTEST_ASSETS,
  periods = CANDIDATE_BACKTEST_PERIODS,
  candidates,
  startMs = CANDIDATE_BACKTEST_START_MS,
  endMs = CANDIDATE_BACKTEST_END_EXCLUSIVE_MS ?? Date.now(),
  log = () => {},
}: {
  readonly db: DatabaseClient;
  readonly assets?: readonly Asset[];
  readonly periods?: readonly TradeDecisionPeriod[];
  readonly candidates?: readonly FilterCandidate[];
  readonly startMs?: number;
  readonly endMs?: number;
  readonly log?: (event: CandidateBacktestLogEvent) => void;
}): Promise<RunCandidateBacktestResult> {
  let rowsWritten = 0;
  let rowsSkipped = 0;
  let markets = 0;
  let decisions = 0;

  for (const asset of assets) {
    for (const period of periods) {
      const periodCandidates =
        candidates ?? registeredCandidatesForMarket({ asset, period });
      const result = await runMarketCandidateBacktest({
        db,
        asset,
        period,
        candidates: periodCandidates,
        startMs,
        endMs,
      });
      if (result.targetCount === 0) {
        log({
          kind: "skip",
          asset,
          period,
          reason: "no stored Pyth candles in backtest window",
        });
        continue;
      }
      rowsWritten += result.rowsWritten;
      rowsSkipped += result.rowsSkipped;
      decisions += result.decisionCount;
      markets += 1;
      log({
        kind: "market",
        asset,
        period,
        candidateCount: periodCandidates.length,
        targetCount: result.targetCount,
        rowCount: result.rowsWritten,
        skippedRowCount: result.rowsSkipped,
      });
    }
  }

  return { rowsWritten, rowsSkipped, markets, decisions };
}

async function runMarketCandidateBacktest({
  db,
  asset,
  period,
  candidates,
  startMs,
  endMs,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly candidates: readonly FilterCandidate[];
  readonly startMs: number;
  readonly endMs: number;
}): Promise<{
  readonly rowsWritten: number;
  readonly rowsSkipped: number;
  readonly targetCount: number;
  readonly decisionCount: number;
}> {
  const periodMs = timeframeMs({ timeframe: period });
  const hydrateBars = tradeDecisionHydrateBars({ period });
  const leadTimeMs = tradeDecisionLeadTimeMs({ period });
  const historyStartMs = Math.max(0, startMs - periodMs * (hydrateBars + 2));
  // The synthetic bar is built from 1m data in the hour *before* the target
  // opens (see doc/DECISION_TIMING.md). We need 1m coverage starting at
  // `startMs - period` for the earliest target whose open == startMs.
  const minuteStartMs = Math.max(0, startMs - periodMs);
  const [periodBars, minuteBars] = await Promise.all([
    loadPythBars({
      db,
      asset,
      timeframe: period,
      startMs: historyStartMs,
      endMs,
    }),
    loadPythBars({
      db,
      asset,
      timeframe: "1m",
      startMs: minuteStartMs,
      endMs,
    }),
  ]);
  const targetBars = periodBars.filter(
    (bar) => bar.openTimeMs >= startMs && bar.openTimeMs < endMs,
  );
  if (targetBars.length === 0 || minuteBars.length === 0) {
    return {
      rowsWritten: 0,
      rowsSkipped: 0,
      targetCount: targetBars.length,
      decisionCount: 0,
    };
  }

  const cachePlans = await buildCachePlans({
    db,
    asset,
    period,
    candidates,
    targetBars,
    periodBars,
    minuteBars,
    startMs,
    endMs,
    periodMs,
    leadTimeMs,
    hydrateBars,
  });
  const skippedPlanKeys = new Set(
    [...cachePlans.values()]
      .filter((plan) => plan.cached)
      .map((plan) => plan.key),
  );
  const accumulators = new Map<string, QuarterAccumulator>();
  let decisionCount = 0;
  for (const targetBar of targetBars) {
    const targetTsMs = targetBar.openTimeMs;
    // See doc/DECISION_TIMING.md.
    // Decision fires `leadTimeMs` BEFORE the target opens.
    // The synthetic represents the *prior* (in-progress) candle, built from
    // 1m bars in [targetTsMs - period, decisionTsMs].
    const decisionTsMs = tradeDecisionFireTimeMs({
      period,
      targetTsMs,
    });
    if (decisionTsMs >= endMs) {
      continue;
    }
    const activeOpenTimeMs = targetTsMs - periodMs;
    const quarterStartMs = quarterStartFor({ tsMs: targetTsMs });
    const closedEndIndex = lowerBoundOpenTime({
      bars: periodBars,
      openTimeMs: targetTsMs,
    });
    // History is fully-closed bars strictly before the now candle. The now
    // candle sits at `closedEndIndex - 1`; we exclude it from history and
    // include its partial via the synthetic instead.
    const history = periodBars.slice(
      Math.max(0, closedEndIndex - 1 - (hydrateBars - 1)),
      Math.max(0, closedEndIndex - 1),
    );
    const syntheticBar = synthesizePartialBar({
      minuteBars,
      activeOpenTimeMs,
      decisionTsMs,
    });
    if (history.length === 0 || syntheticBar === null) {
      continue;
    }
    const series = alignMarketSeries({
      pyth: [...history, syntheticBar],
      coinbase: [],
    });
    const outcome = resolveDirectionalOutcome({
      startPrice: targetBar.open,
      endPrice: targetBar.close,
    });
    for (const candidate of candidates) {
      const cachePlan = cachePlans.get(
        cachePlanKey({ candidate, asset, period, quarterStartMs }),
      );
      if (cachePlan === undefined || cachePlan.cached) {
        continue;
      }
      const accumulator = getAccumulator({
        accumulators,
        cachePlan,
      });
      const evaluation = candidate.evaluate({
        asset,
        period,
        targetTsMs,
        series,
      });
      accumulator.evaluatedCount += 1;
      if (evaluation.decision === "neutral") {
        accumulator.neutralCount += 1;
        continue;
      }
      const prediction = predictionFromFilterDecision(evaluation.decision);
      const won = prediction === outcome ? 1 : 0;
      accumulator.decisions.push([targetTsMs, prediction, won]);
      accumulator.decisionCount += 1;
      accumulator.winCount += won;
      accumulator.lossCount += won === 1 ? 0 : 1;
      decisionCount += 1;
    }
  }

  let rowsWritten = 0;
  for (const accumulator of accumulators.values()) {
    await persistAccumulator({ db, accumulator });
    rowsWritten += 1;
  }
  return {
    rowsWritten,
    rowsSkipped: skippedPlanKeys.size,
    targetCount: targetBars.length,
    decisionCount,
  };
}

type CachePlan = {
  readonly key: string;
  readonly candidate: FilterCandidate;
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly quarterStartMs: number;
  readonly quarterLabel: string;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly cacheHash: string;
  readonly cached: boolean;
};

async function buildCachePlans({
  db,
  asset,
  period,
  candidates,
  targetBars,
  periodBars,
  minuteBars,
  startMs,
  endMs,
  periodMs,
  leadTimeMs,
  hydrateBars,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly candidates: readonly FilterCandidate[];
  readonly targetBars: readonly MarketBar[];
  readonly periodBars: readonly MarketBar[];
  readonly minuteBars: readonly MarketBar[];
  readonly startMs: number;
  readonly endMs: number;
  readonly periodMs: number;
  readonly leadTimeMs: number;
  readonly hydrateBars: number;
}): Promise<ReadonlyMap<string, CachePlan>> {
  const quarterStarts = [
    ...new Set(
      targetBars.map((targetBar) =>
        quarterStartFor({ tsMs: targetBar.openTimeMs }),
      ),
    ),
  ];
  const existing = await loadExistingCacheHashes({
    db,
    asset,
    period,
    candidates,
    quarterStarts,
  });
  const plans = new Map<string, CachePlan>();

  for (const quarterStartMs of quarterStarts) {
    const { windowStartMs, windowEndMs } = quarterWindowFor({
      quarterStartMs,
      startMs,
      endMs,
    });
    const periodStartMs = Math.max(
      0,
      windowStartMs - periodMs * (hydrateBars + 2),
    );
    const minuteStartMs = windowStartMs;
    const inputDataHash = candidateBacktestInputDataHash({
      periodBars,
      minuteBars,
      periodStartMs,
      minuteStartMs,
      windowEndMs,
    });
    for (const candidate of candidates) {
      const key = cachePlanKey({
        candidate,
        asset,
        period,
        quarterStartMs,
      });
      const cacheHash = candidateBacktestCacheHash({
        candidate,
        asset,
        period,
        source: "pyth",
        quarterStartMs,
        windowStartMs,
        windowEndMs,
        decisionSchemaVersion: CANDIDATE_BACKTEST_DECISION_SCHEMA_VERSION,
        engineVersion: CANDIDATE_BACKTEST_ENGINE_VERSION,
        leadTimeMs,
        hydrateBars,
        inputDataHash,
      });
      plans.set(key, {
        key,
        candidate,
        asset,
        period,
        quarterStartMs,
        quarterLabel: quarterLabelFor({ quarterStartMs }),
        windowStartMs,
        windowEndMs,
        cacheHash,
        cached: existing.get(key) === cacheHash,
      });
    }
  }

  return plans;
}

async function loadExistingCacheHashes({
  db,
  asset,
  period,
  candidates,
  quarterStarts,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly candidates: readonly FilterCandidate[];
  readonly quarterStarts: readonly number[];
}): Promise<ReadonlyMap<string, string>> {
  if (candidates.length === 0 || quarterStarts.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectFrom("candidate_backtest_quarter_results")
    .select(["candidate_id", "quarter_start_ms", "cache_hash"])
    .where("asset", "=", asset)
    .where("timeframe", "=", period)
    .where(
      "candidate_id",
      "in",
      candidates.map((candidate) => candidate.id),
    )
    .where(
      "quarter_start_ms",
      "in",
      quarterStarts.map((quarterStartMs) => String(quarterStartMs)),
    )
    .execute();
  return new Map(
    rows.map((row) => [
      cachePlanKey({
        candidateId: row.candidate_id,
        asset,
        period,
        quarterStartMs: Number(row.quarter_start_ms),
      }),
      row.cache_hash,
    ]),
  );
}

function cachePlanKey({
  candidate,
  candidateId,
  asset,
  period,
  quarterStartMs,
}: {
  readonly candidate?: FilterCandidate;
  readonly candidateId?: string;
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly quarterStartMs: number;
}): string {
  return `${candidate?.id ?? candidateId}|${asset}|${period}|${quarterStartMs}`;
}

type CandleTimeframeForBacktest = "1m" | TradeDecisionPeriod;

async function loadPythBars({
  db,
  asset,
  timeframe,
  startMs,
  endMs,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly timeframe: CandleTimeframeForBacktest;
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

type DecisionTuple = readonly [number, "up" | "down", 0 | 1];

type QuarterAccumulator = {
  readonly cacheHash: string;
  readonly candidate: FilterCandidate;
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly quarterStartMs: number;
  readonly quarterLabel: string;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  evaluatedCount: number;
  decisionCount: number;
  winCount: number;
  lossCount: number;
  neutralCount: number;
  decisions: DecisionTuple[];
};

function getAccumulator({
  accumulators,
  cachePlan,
}: {
  readonly accumulators: Map<string, QuarterAccumulator>;
  readonly cachePlan: CachePlan;
}): QuarterAccumulator {
  const key = cachePlan.key;
  const existing = accumulators.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const accumulator: QuarterAccumulator = {
    cacheHash: cachePlan.cacheHash,
    candidate: cachePlan.candidate,
    asset: cachePlan.asset,
    period: cachePlan.period,
    quarterStartMs: cachePlan.quarterStartMs,
    quarterLabel: cachePlan.quarterLabel,
    windowStartMs: cachePlan.windowStartMs,
    windowEndMs: cachePlan.windowEndMs,
    evaluatedCount: 0,
    decisionCount: 0,
    winCount: 0,
    lossCount: 0,
    neutralCount: 0,
    decisions: [],
  };
  accumulators.set(key, accumulator);
  return accumulator;
}

function predictionFromFilterDecision(
  decision: Exclude<FilterDecision, "neutral">,
): "up" | "down" {
  return decision;
}

async function persistAccumulator({
  db,
  accumulator,
}: {
  readonly db: DatabaseClient;
  readonly accumulator: QuarterAccumulator;
}): Promise<void> {
  const candidate = accumulator.candidate;
  await db
    .insertInto("candidate_backtest_quarter_results")
    .values({
      candidate_id: candidate.id,
      filter_id: candidate.filterId,
      filter_name: candidate.filterName,
      filter_version: candidate.filterVersion,
      cache_hash: accumulator.cacheHash,
      config_canon: candidate.configCanon,
      config_hash: candidate.configHash,
      config_json: sql`${JSON.stringify(candidate.config)}::jsonb`,
      asset: accumulator.asset,
      timeframe: accumulator.period,
      source: "pyth",
      quarter_start_ms: accumulator.quarterStartMs,
      quarter_label: accumulator.quarterLabel,
      window_start_ms: accumulator.windowStartMs,
      window_end_ms: accumulator.windowEndMs,
      evaluated_count: accumulator.evaluatedCount,
      decision_count: accumulator.decisionCount,
      win_count: accumulator.winCount,
      loss_count: accumulator.lossCount,
      neutral_count: accumulator.neutralCount,
      decision_schema_version: CANDIDATE_BACKTEST_DECISION_SCHEMA_VERSION,
      decisions: sql`${JSON.stringify(accumulator.decisions)}::jsonb`,
      generated_at_ms: Date.now(),
    })
    .onConflict((conflict) =>
      conflict
        .columns(["candidate_id", "asset", "timeframe", "quarter_start_ms"])
        .doUpdateSet({
          filter_id: sql`excluded.filter_id`,
          filter_name: sql`excluded.filter_name`,
          filter_version: sql`excluded.filter_version`,
          cache_hash: sql`excluded.cache_hash`,
          config_canon: sql`excluded.config_canon`,
          config_hash: sql`excluded.config_hash`,
          config_json: sql`excluded.config_json`,
          source: sql`excluded.source`,
          quarter_label: sql`excluded.quarter_label`,
          window_start_ms: sql`excluded.window_start_ms`,
          window_end_ms: sql`excluded.window_end_ms`,
          evaluated_count: sql`excluded.evaluated_count`,
          decision_count: sql`excluded.decision_count`,
          win_count: sql`excluded.win_count`,
          loss_count: sql`excluded.loss_count`,
          neutral_count: sql`excluded.neutral_count`,
          decision_schema_version: sql`excluded.decision_schema_version`,
          decisions: sql`excluded.decisions`,
          generated_at_ms: sql`excluded.generated_at_ms`,
        }),
    )
    .execute();
}
