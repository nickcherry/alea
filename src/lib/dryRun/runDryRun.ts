import "@alea/lib/filters/all";

import { DRY_RUN_MARKET_DISCOVERY_LEAD_MS } from "@alea/constants/dryRun";
import {
  TRADE_DECISION_DEFAULT_PERIODS,
  TRADE_DECISION_HYDRATE_BARS,
  TRADE_DECISION_LEAD_TIME_MS,
  type TradeDecisionPeriod,
} from "@alea/constants/tradeDecision";
import { listCommitteeCandidates } from "@alea/lib/committee/runCommittee";
import {
  candidateRosterKey,
  type CommitteeRoster,
  loadCommitteeRoster,
} from "@alea/lib/committee/selection/loadCommitteeRoster";
import type { DatabaseClient } from "@alea/lib/db/types";
import {
  createDryRunOrderSimulator,
  type DryRunOrderLogEvent,
} from "@alea/lib/dryRun/orderSimulation";
import type { AlignedBarSeries } from "@alea/lib/filters/barSeries";
import type { Candidate, FilterBar } from "@alea/lib/filters/types";
import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import type { MarketRegime } from "@alea/lib/regime/types";
import {
  hydrateTradeDecisionCandleState,
  refreshTradeDecisionCandleState,
  type TradeDecisionCandleState,
} from "@alea/lib/tradeDecision/candleState";
import { evaluateTradeDecision } from "@alea/lib/tradeDecision/evaluateTradeDecision";
import { createMarketEventPythCandleFetcher } from "@alea/lib/tradeDecision/marketEventCandles";
import { createPolymarketMarketDiscoveryCache } from "@alea/lib/trading/vendor/polymarket/marketDiscoveryCache";
import type { Asset } from "@alea/types/assets";

export type DryRunHandle = {
  readonly stop: () => Promise<void>;
};

export type DryRunOptions = {
  readonly db: DatabaseClient;
  readonly assets: readonly Asset[];
  readonly periods?: readonly TradeDecisionPeriod[];
  readonly log: (event: DryRunLogEvent) => void;
};

export type DryRunLogEvent =
  | {
      readonly kind: "hydrated";
      readonly asset: Asset;
      readonly period: TradeDecisionPeriod;
      readonly barCount: number;
    }
  | { readonly kind: "ready" }
  | {
      readonly kind: "roster";
      readonly bucketCount: number;
      readonly totalCandidates: number;
      readonly selectedAtMs: number | null;
    }
  | {
      readonly kind: "decision";
      readonly asset: Asset;
      readonly period: TradeDecisionPeriod;
      readonly tsMs: number;
      readonly prediction: "u" | "d" | null;
      readonly synthClose: number;
      readonly marketRegime: MarketRegime | null;
      readonly rosterSize: number;
      readonly up: number;
      readonly down: number;
      readonly abstain: number;
    }
  | {
      readonly kind: "outcome";
      readonly asset: Asset;
      readonly period: TradeDecisionPeriod;
      readonly tsMs: number;
      readonly prediction: "u" | "d";
      readonly actualClose: number;
      readonly actualOpen: number;
      readonly won: boolean;
    }
  | DryRunOrderLogEvent
  | { readonly kind: "error"; readonly message: string };

/**
 * Starts the dry-run loop. Returns a handle whose `.stop()` cleanly
 * stops the scheduler and order simulator.
 *
 * Operations:
 *   1. Hydrate per-asset/per-period bar buffers from fresh Pyth candles
 *      (most recent trade-decision history bars).
 *   2. Shortly before each configured boundary, refresh recent Pyth
 *      candles into the in-memory buffer and synthesize the active
 *      candle from the latest one-shot Pyth price.
 *   3. Run the committee against that refreshed/synthetic bar set and
 *      persist the decision if it's not an abstain.
 *   4. For non-abstain decisions, simulate the configured pre-open
 *      Polymarket order and track whether it fills before expiry.
 *
 * The dry-run loop is single-threaded by design — all state lives
 * in the closure, no locking required. Persistence is the only
 * external side-effect.
 */
export async function runDryRun({
  db,
  assets,
  periods = TRADE_DECISION_DEFAULT_PERIODS,
  log,
}: DryRunOptions): Promise<DryRunHandle> {
  const selectedPeriods: TradeDecisionPeriod[] =
    periods.length === 0
      ? [...TRADE_DECISION_DEFAULT_PERIODS]
      : Array.from(new Set(periods));
  const states = new Map<string, TradeDecisionCandleState>();
  const statesByPeriod = new Map<
    TradeDecisionPeriod,
    TradeDecisionCandleState[]
  >();
  for (const period of selectedPeriods) {
    statesByPeriod.set(period, []);
  }
  const fetchCandles = createMarketEventPythCandleFetcher({ db });
  // Hydrate.
  for (const asset of assets) {
    for (const period of selectedPeriods) {
      const state = await hydrateTradeDecisionCandleState({
        asset,
        period,
        limit: TRADE_DECISION_HYDRATE_BARS,
        fetchCandles,
      });
      states.set(dryRunStateKey({ asset, period }), state);
      statesByPeriod.get(period)?.push(state);
      log({ kind: "hydrated", asset, period, barCount: state.bars.length });
    }
  }
  const candidates = listCommitteeCandidates();
  const roster = await loadCommitteeRoster({ db });
  {
    let total = 0;
    for (const bucket of roster.byBucket.values()) {
      total += bucket.length;
    }
    log({
      kind: "roster",
      bucketCount: roster.byBucket.size,
      totalCandidates: total,
      selectedAtMs: roster.selectedAtMs,
    });
  }
  // Index candidates by roster key for O(1) lookup at decision time.
  const candidatesByKey = new Map<string, Candidate>();
  for (const cand of candidates) {
    candidatesByKey.set(
      candidateRosterKey({
        filterId: cand.filterId,
        filterVersion: cand.version,
        configCanon: cand.configCanon,
      }),
      cand,
    );
  }

  let running = true;
  // Track decision rows pending scoring by asset/period state, then target bar open.
  const pendingByState = new Map<string, Map<number, string>>();
  for (const state of states.values()) {
    pendingByState.set(
      dryRunStateKey({ asset: state.asset, period: state.period }),
      new Map(),
    );
  }
  const marketDiscovery = createPolymarketMarketDiscoveryCache();
  const orderSimulator = createDryRunOrderSimulator({
    db,
    marketDiscovery,
    log: (event) => log(event),
  });
  log({ kind: "ready" });

  // Scheduler loop — checks roughly every second whether we've
  // crossed into the predict-now window.
  const tick = async (): Promise<void> => {
    while (running) {
      try {
        const now = Date.now();
        marketDiscovery.warm({
          assets,
          timeframes: selectedPeriods,
          nowMs: now,
          discoveryLeadMs: DRY_RUN_MARKET_DISCOVERY_LEAD_MS,
        });
        await orderSimulator.tick({ nowMs: now });
        let nextFireTime = now + 1000;
        for (const period of selectedPeriods) {
          const periodMs = resolutionTimeframeStepMs({ timeframe: period });
          const nextBoundary = Math.ceil(now / periodMs) * periodMs;
          const fireTime = nextBoundary - TRADE_DECISION_LEAD_TIME_MS;
          nextFireTime = Math.min(nextFireTime, fireTime);
          if (now >= fireTime) {
            for (const state of statesByPeriod.get(period) ?? []) {
              if (state.lastPredictedBoundary >= nextBoundary) {
                continue;
              }
              let refreshed: Awaited<
                ReturnType<typeof refreshTradeDecisionCandleState>
              >;
              try {
                refreshed = await refreshTradeDecisionCandleState({
                  state,
                  nowMs: now,
                  limit: TRADE_DECISION_HYDRATE_BARS,
                  fetchCandles,
                });
              } catch (e) {
                log({
                  kind: "error",
                  message: `candle refresh failed ${state.period}/${state.asset}: ${String(e)}`,
                });
                continue;
              }
              await scorePendingDecisions({
                db,
                state,
                pendingByState,
                log,
              });
              if (
                refreshed.syntheticBar === null ||
                refreshed.seriesForDecision === null
              ) {
                const reason =
                  refreshed.priceAgeMs === null
                    ? "missing latest Pyth price"
                    : `latest Pyth price stale (${refreshed.priceAgeMs}ms old)`;
                log({
                  kind: "error",
                  message: `skip decision ${state.period}/${state.asset}: ${reason}`,
                });
                continue;
              }
              state.lastPredictedBoundary = nextBoundary;
              await makePrediction({
                db,
                state,
                targetTsMs: nextBoundary,
                series: refreshed.seriesForDecision,
                synthBar: refreshed.syntheticBar,
                roster,
                candidatesByKey,
                pendingByState,
                orderSimulator,
                log,
              });
            }
          }
        }
        const sleepMs = Math.max(250, Math.min(nextFireTime - now + 1, 1000));
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      } catch (e) {
        log({ kind: "error", message: `scheduler: ${String(e)}` });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  };
  void tick();

  return {
    async stop(): Promise<void> {
      running = false;
      await orderSimulator.stop();
    },
  };
}

async function makePrediction({
  db,
  state,
  targetTsMs,
  series,
  synthBar,
  roster,
  candidatesByKey,
  pendingByState,
  orderSimulator,
  log,
}: {
  readonly db: DatabaseClient;
  readonly state: TradeDecisionCandleState;
  readonly targetTsMs: number;
  readonly series: AlignedBarSeries;
  readonly synthBar: FilterBar;
  readonly roster: CommitteeRoster;
  readonly candidatesByKey: ReadonlyMap<string, Candidate>;
  readonly pendingByState: Map<string, Map<number, string>>;
  readonly orderSimulator: ReturnType<typeof createDryRunOrderSimulator>;
  readonly log: (event: DryRunLogEvent) => void;
}): Promise<void> {
  const decisionStartedAtMs = Date.now();
  const evaluated = evaluateTradeDecision({
    asset: state.asset,
    period: state.period,
    series,
    roster,
    candidatesByKey,
  });
  const decisionCompletedAtMs = Date.now();
  const decisionDurationMs = decisionCompletedAtMs - decisionStartedAtMs;
  log({
    kind: "decision",
    asset: state.asset,
    period: state.period,
    tsMs: targetTsMs,
    prediction: evaluated.prediction,
    synthClose: synthBar.close,
    marketRegime: evaluated.marketRegime,
    rosterSize: evaluated.rosterSize,
    up: evaluated.up,
    down: evaluated.down,
    abstain: evaluated.abstain,
  });
  if (evaluated.prediction === null) {
    await recordDecisionAttempt({
      db,
      state,
      targetTsMs,
      decisionStartedAtMs,
      decisionCompletedAtMs,
      decisionDurationMs,
      prediction: null,
      marketRegime: evaluated.marketRegime,
      rosterSize: evaluated.rosterSize,
      up: evaluated.up,
      down: evaluated.down,
      abstain: evaluated.abstain,
      decisionId: null,
    });
    return;
  }
  const prediction = evaluated.prediction;
  // Persist. The target bar's open = targetTsMs (i.e. the upcoming
  // period boundary). Its open price is approximately the current
  // Pyth price (close of the bar we just synthesised). We persist
  // that as `synth_open` because it's both the synthetic close of
  // the prior bar AND the open we're betting the next bar moves away
  // from.
  //
  // `regime_votes` keeps its legacy column name but stores the
  // filter-collapsed decision tally — `{up, down, abstain}`. Old
  // rows from before this change still hold the array-shaped
  // per-family breakdown; the dashboard loader handles both formats.
  const inserted = await db
    .insertInto("dry_run_decisions")
    .values({
      ts_ms: targetTsMs,
      decided_at_ms: Date.now(),
      asset: state.asset,
      period: state.period,
      prediction,
      synth_open: synthBar.close,
      regime_votes: JSON.stringify({
        up: evaluated.up,
        down: evaluated.down,
        abstain: evaluated.abstain,
        avgWinningVoteConfidence: evaluated.orderConfidence,
      }),
      market_regime: evaluated.marketRegime,
      decision_started_at_ms: decisionStartedAtMs,
      decision_completed_at_ms: decisionCompletedAtMs,
      decision_duration_ms: decisionDurationMs,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await recordDecisionAttempt({
    db,
    state,
    targetTsMs,
    decisionStartedAtMs,
    decisionCompletedAtMs,
    decisionDurationMs,
    prediction,
    marketRegime: evaluated.marketRegime,
    rosterSize: evaluated.rosterSize,
    up: evaluated.up,
    down: evaluated.down,
    abstain: evaluated.abstain,
    decisionId: String(inserted.id),
  });
  const pending = pendingByState.get(
    dryRunStateKey({ asset: state.asset, period: state.period }),
  );
  if (pending !== undefined) {
    pending.set(targetTsMs, String(inserted.id));
  }
  await orderSimulator.scheduleOrder({
    decisionId: String(inserted.id),
    asset: state.asset,
    period: state.period,
    prediction,
    targetTsMs,
    confidence: evaluated.orderConfidence,
  });
}

async function recordDecisionAttempt({
  db,
  state,
  targetTsMs,
  decisionStartedAtMs,
  decisionCompletedAtMs,
  decisionDurationMs,
  prediction,
  marketRegime,
  rosterSize,
  up,
  down,
  abstain,
  decisionId,
}: {
  readonly db: DatabaseClient;
  readonly state: TradeDecisionCandleState;
  readonly targetTsMs: number;
  readonly decisionStartedAtMs: number;
  readonly decisionCompletedAtMs: number;
  readonly decisionDurationMs: number;
  readonly prediction: "u" | "d" | null;
  readonly marketRegime: MarketRegime | null;
  readonly rosterSize: number;
  readonly up: number;
  readonly down: number;
  readonly abstain: number;
  readonly decisionId: string | null;
}): Promise<void> {
  await db
    .insertInto("dry_run_decision_attempts")
    .values({
      ts_ms: targetTsMs,
      asset: state.asset,
      period: state.period,
      decision_started_at_ms: decisionStartedAtMs,
      decision_completed_at_ms: decisionCompletedAtMs,
      decision_duration_ms: decisionDurationMs,
      prediction,
      market_regime: marketRegime,
      roster_size: rosterSize,
      up_votes: up,
      down_votes: down,
      abstain_votes: abstain,
      dry_run_decision_id: decisionId,
    })
    .execute();
}

async function scorePendingDecisions({
  db,
  state,
  pendingByState,
  log,
}: {
  readonly db: DatabaseClient;
  readonly state: TradeDecisionCandleState;
  readonly pendingByState: Map<string, Map<number, string>>;
  readonly log: (event: DryRunLogEvent) => void;
}): Promise<void> {
  const pending = pendingByState.get(
    dryRunStateKey({ asset: state.asset, period: state.period }),
  );
  if (pending === undefined) {
    return;
  }
  const barsByOpenTime = new Map<number, FilterBar>();
  for (const bar of state.bars) {
    barsByOpenTime.set(bar.openTimeMs, bar);
  }
  for (const [targetTsMs, decisionId] of [...pending.entries()]) {
    const closedBar = barsByOpenTime.get(targetTsMs);
    if (closedBar === undefined) {
      continue;
    }
    pending.delete(targetTsMs);
    await scoreDecision({
      db,
      state,
      decisionId,
      closedBar,
      log,
    });
  }
}

async function scoreDecision({
  db,
  state,
  decisionId,
  closedBar,
  log,
}: {
  readonly db: DatabaseClient;
  readonly state: TradeDecisionCandleState;
  readonly decisionId: string;
  readonly closedBar: FilterBar;
  readonly log: (event: DryRunLogEvent) => void;
}): Promise<void> {
  // Tie handling matches the backtest: close == open ⇒ "up".
  const actualUp = closedBar.close >= closedBar.open;
  // Look up the prediction so we know how to score.
  const row = await db
    .selectFrom("dry_run_decisions")
    .select(["prediction"])
    .where("id", "=", decisionId)
    .executeTakeFirstOrThrow();
  const predictedUp = row.prediction === "u";
  const won = actualUp === predictedUp ? 1 : 0;
  await db
    .updateTable("dry_run_decisions")
    .set({
      actual_close: closedBar.close,
      won,
    })
    .where("id", "=", decisionId)
    .execute();
  log({
    kind: "outcome",
    asset: state.asset,
    period: state.period,
    tsMs: closedBar.openTimeMs,
    prediction: row.prediction,
    actualClose: closedBar.close,
    actualOpen: closedBar.open,
    won: won === 1,
  });
}

function dryRunStateKey({
  asset,
  period,
}: {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
}): string {
  return `${period}:${asset}`;
}
