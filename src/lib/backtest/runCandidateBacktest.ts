import {
  CANDIDATE_BACKTEST_ASSETS,
  CANDIDATE_BACKTEST_DECISION_SCHEMA_VERSION,
  CANDIDATE_BACKTEST_END_EXCLUSIVE_MS,
  CANDIDATE_BACKTEST_PERIODS,
  CANDIDATE_BACKTEST_START_MS,
} from "@alea/constants/backtest";
import {
  tradeDecisionHydrateBars,
  tradeDecisionLeadTimeMs,
  type TradeDecisionPeriod,
} from "@alea/constants/tradeDecision";
import { timeframeMs } from "@alea/lib/candles/timeframeMs";
import type { DatabaseClient } from "@alea/lib/db/types";
import { registeredCandidates } from "@alea/lib/filters/registry";
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
    }
  | {
      readonly kind: "skip";
      readonly asset: Asset;
      readonly period: TradeDecisionPeriod;
      readonly reason: string;
    };

export type RunCandidateBacktestResult = {
  readonly rowsWritten: number;
  readonly markets: number;
  readonly decisions: number;
};

export async function runCandidateBacktest({
  db,
  assets = CANDIDATE_BACKTEST_ASSETS,
  periods = CANDIDATE_BACKTEST_PERIODS,
  candidates = registeredCandidates,
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
  let markets = 0;
  let decisions = 0;

  for (const asset of assets) {
    for (const period of periods) {
      const result = await runMarketCandidateBacktest({
        db,
        asset,
        period,
        candidates,
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
      decisions += result.decisionCount;
      markets += 1;
      log({
        kind: "market",
        asset,
        period,
        candidateCount: candidates.length,
        targetCount: result.targetCount,
        rowCount: result.rowsWritten,
      });
    }
  }

  return { rowsWritten, markets, decisions };
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
  readonly targetCount: number;
  readonly decisionCount: number;
}> {
  const periodMs = timeframeMs({ timeframe: period });
  const hydrateBars = tradeDecisionHydrateBars({ period });
  const historyStartMs = Math.max(0, startMs - periodMs * (hydrateBars + 2));
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
      startMs: Math.max(0, startMs - periodMs),
      endMs,
    }),
  ]);
  const targetBars = periodBars.filter(
    (bar) => bar.openTimeMs >= startMs && bar.openTimeMs < endMs,
  );
  if (targetBars.length === 0 || minuteBars.length === 0) {
    return { rowsWritten: 0, targetCount: targetBars.length, decisionCount: 0 };
  }

  const accumulators = new Map<string, QuarterAccumulator>();
  let decisionCount = 0;
  for (const targetBar of targetBars) {
    const targetTsMs = targetBar.openTimeMs;
    const activeOpenTimeMs = targetTsMs - periodMs;
    const decisionTsMs = targetTsMs - tradeDecisionLeadTimeMs({ period });
    const closedEndIndex = lowerBoundOpenTime({
      bars: periodBars,
      openTimeMs: activeOpenTimeMs,
    });
    const history = periodBars.slice(
      Math.max(0, closedEndIndex - (hydrateBars - 1)),
      closedEndIndex,
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
      const accumulator = getAccumulator({
        accumulators,
        candidate,
        asset,
        period,
        targetTsMs,
        startMs,
        endMs,
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
  return { rowsWritten, targetCount: targetBars.length, decisionCount };
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
  candidate,
  asset,
  period,
  targetTsMs,
  startMs,
  endMs,
}: {
  readonly accumulators: Map<string, QuarterAccumulator>;
  readonly candidate: FilterCandidate;
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly targetTsMs: number;
  readonly startMs: number;
  readonly endMs: number;
}): QuarterAccumulator {
  const quarterStartMs = quarterStartFor({ tsMs: targetTsMs });
  const key = `${candidate.id}|${asset}|${period}|${quarterStartMs}`;
  const existing = accumulators.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const accumulator: QuarterAccumulator = {
    candidate,
    asset,
    period,
    quarterStartMs,
    quarterLabel: quarterLabelFor({ quarterStartMs }),
    windowStartMs: startMs,
    windowEndMs: endMs,
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

function quarterStartFor({ tsMs }: { readonly tsMs: number }): number {
  const date = new Date(tsMs);
  const year = date.getUTCFullYear();
  const quarterMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  return Date.UTC(year, quarterMonth, 1);
}

function quarterLabelFor({
  quarterStartMs,
}: {
  readonly quarterStartMs: number;
}): string {
  const date = new Date(quarterStartMs);
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()} Q${quarter}`;
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
