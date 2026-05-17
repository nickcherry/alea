import {
  DRY_RUN_MARKET_DISCOVERY_LEAD_MS,
  type DryRunOrderStatus,
} from "@alea/constants/dryRun";
import {
  resolveTradeDecisionMarkets,
  TRADE_DECISION_DECISION_SOURCE,
  tradeDecisionHydrateBars,
  tradeDecisionLeadTimeMs,
  type TradeDecisionMarket,
  tradeDecisionMarketPeriods,
  type TradeDecisionPeriod,
} from "@alea/constants/tradeDecision";
import type { DatabaseClient } from "@alea/lib/db/types";
import {
  createDryRunOrderSimulator,
  type DryRunOrderLogEvent,
} from "@alea/lib/dryRun/orderSimulation";
import { evaluateCandidateTradeDecision } from "@alea/lib/filters/evaluateCandidates";
import type { AlignedMarketSeries } from "@alea/lib/marketSeries/align";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import {
  type FetchCandles,
  hydrateTradeDecisionCandleState,
  refreshTradeDecisionCandleState,
  type TradeDecisionCandleState,
} from "@alea/lib/tradeDecision/candleState";
import { createMarketEventPythCandleFetcher } from "@alea/lib/tradeDecision/marketEventCandles";
import { createPolymarketMarketDiscoveryCache } from "@alea/lib/trading/vendor/polymarket/marketDiscoveryCache";
import type { Asset } from "@alea/types/assets";

export type DryRunHandle = {
  readonly stop: () => Promise<void>;
};

export type DryRunOptions = {
  readonly db: DatabaseClient;
  readonly assets?: readonly Asset[];
  readonly markets?: readonly TradeDecisionMarket[];
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
      readonly kind: "predictor";
      readonly source: typeof TRADE_DECISION_DECISION_SOURCE;
    }
  | {
      readonly kind: "decision";
      readonly asset: Asset;
      readonly period: TradeDecisionPeriod;
      readonly tsMs: number;
      readonly prediction: "u" | "d" | null;
      readonly decision: "up" | "down" | "neutral";
      readonly synthClose: number;
      readonly sourceCount: number;
      readonly up: number;
      readonly down: number;
      readonly abstain: number;
      readonly reasoning: string | null;
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
      readonly orderStatus: DryRunOrderStatus;
      readonly orderLimitPrice: number | null;
      readonly orderFillPrice: number | null;
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
 *      candles into the in-memory buffer and synthesize the active candle
 *      from the latest one-shot Pyth price.
 *   3. Evaluate the period's registered filter candidates on that same decision
 *      series and persist only actionable up/down majorities.
 *   4. Simulate the configured pre-open Polymarket order and track whether it
 *      fills before expiry.
 *
 * The dry-run loop is single-threaded by design — all state lives
 * in the closure, no locking required. Persistence is the only
 * external side-effect.
 */
export async function runDryRun({
  db,
  assets,
  markets,
  periods,
  log,
}: DryRunOptions): Promise<DryRunHandle> {
  const selectedMarkets = resolveTradeDecisionMarkets({
    markets,
    assets,
    periods,
  });
  const selectedPeriods = tradeDecisionMarketPeriods({
    markets: selectedMarkets,
  });
  const discoveryMarkets = selectedMarkets.map(({ asset, period }) => ({
    asset,
    timeframe: period,
  }));
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
  for (const { asset, period } of selectedMarkets) {
    const hydrateBars = tradeDecisionHydrateBars({ period });
    const state = await hydrateTradeDecisionCandleState({
      asset,
      period,
      limit: hydrateBars,
      fetchCandles,
      fetchCoinbaseBarsForHydrate: fetchNoCandles,
    });
    states.set(dryRunStateKey({ asset, period }), state);
    statesByPeriod.get(period)?.push(state);
    log({ kind: "hydrated", asset, period, barCount: state.bars.length });
  }
  log({
    kind: "predictor",
    source: TRADE_DECISION_DECISION_SOURCE,
  });

  let running = true;
  // Track decision rows pending scoring by asset/period state, then target bar open.
  const pendingByState = new Map<string, Map<number, string>>();
  for (const state of states.values()) {
    pendingByState.set(
      dryRunStateKey({ asset: state.asset, period: state.period }),
      new Map(),
    );
  }
  await hydratePendingDryRunDecisions({
    db,
    pendingByState,
  });
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
          markets: discoveryMarkets,
          nowMs: now,
          discoveryLeadMs: DRY_RUN_MARKET_DISCOVERY_LEAD_MS,
        });
        await orderSimulator.tick({ nowMs: now });
        let nextFireTime = now + 1000;
        for (const period of selectedPeriods) {
          const periodMs = resolutionTimeframeStepMs({ timeframe: period });
          const nextBoundary = Math.ceil(now / periodMs) * periodMs;
          const fireTime = nextBoundary - tradeDecisionLeadTimeMs({ period });
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
                  limit: tradeDecisionHydrateBars({ period: state.period }),
                  fetchCandles,
                  fetchCoinbaseBarsForRefresh: fetchNoCandles,
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
  pendingByState,
  orderSimulator,
  log,
}: {
  readonly db: DatabaseClient;
  readonly state: TradeDecisionCandleState;
  readonly targetTsMs: number;
  readonly series: AlignedMarketSeries;
  readonly synthBar: MarketBar;
  readonly pendingByState: Map<string, Map<number, string>>;
  readonly orderSimulator: ReturnType<typeof createDryRunOrderSimulator>;
  readonly log: (event: DryRunLogEvent) => void;
}): Promise<void> {
  const decisionStartedAtMs = Date.now();
  const evaluated = evaluateCandidateTradeDecision({
    context: {
      asset: state.asset,
      period: state.period,
      targetTsMs,
      series,
    },
  });
  const decisionCompletedAtMs = Date.now();
  const decisionDurationMs = decisionCompletedAtMs - decisionStartedAtMs;
  log({
    kind: "decision",
    asset: state.asset,
    period: state.period,
    tsMs: targetTsMs,
    prediction: evaluated.prediction,
    decision: evaluated.decision,
    synthClose: synthBar.close,
    sourceCount: evaluated.votes.length,
    up: evaluated.up,
    down: evaluated.down,
    abstain: evaluated.neutral,
    reasoning: evaluated.summary,
  });
  const prediction = evaluated.prediction;
  if (prediction === null) {
    await recordDecisionAttempt({
      db,
      state,
      targetTsMs,
      decisionStartedAtMs,
      decisionCompletedAtMs,
      decisionDurationMs,
      prediction,
      sourceCount: evaluated.votes.length,
      up: evaluated.up,
      down: evaluated.down,
      abstain: evaluated.neutral,
      decisionId: null,
    });
    return;
  }
  // Persist. The target bar's open = targetTsMs (i.e. the upcoming
  // period boundary). Its open price is approximately the current
  // Pyth price (close of the bar we just synthesised). We persist
  // that as `synth_open` because it's both the synthetic close of
  // the prior bar AND the open we're betting the next bar moves away
  // from.
  //
  const inserted = await db
    .insertInto("dry_run_decisions")
    .values({
      ts_ms: targetTsMs,
      decided_at_ms: Date.now(),
      asset: state.asset,
      period: state.period,
      prediction,
      synth_open: synthBar.close,
      decision_audit: JSON.stringify({
        source: TRADE_DECISION_DECISION_SOURCE,
        decision: evaluated.decision,
        reasoning: evaluated.summary,
        up: evaluated.up,
        down: evaluated.down,
        abstain: evaluated.neutral,
        votes: evaluated.votes,
      }),
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
    sourceCount: evaluated.votes.length,
    up: evaluated.up,
    down: evaluated.down,
    abstain: evaluated.neutral,
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
    confidence: null,
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
  sourceCount,
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
  readonly sourceCount: number;
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
      source_count: sourceCount,
      up_votes: up,
      down_votes: down,
      abstain_votes: abstain,
      dry_run_decision_id: decisionId,
    })
    .execute();
}

async function hydratePendingDryRunDecisions({
  db,
  pendingByState,
}: {
  readonly db: DatabaseClient;
  readonly pendingByState: Map<string, Map<number, string>>;
}): Promise<void> {
  const rows = await db
    .selectFrom("dry_run_decisions")
    .select(["id", "ts_ms", "asset", "period"])
    .where("won", "is", null)
    .execute();

  for (const row of rows) {
    const pending = pendingByState.get(
      dryRunStateKey({
        asset: row.asset as Asset,
        period: row.period as TradeDecisionPeriod,
      }),
    );
    if (pending === undefined) {
      continue;
    }
    pending.set(Number(row.ts_ms), String(row.id));
  }
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
  const barsByOpenTime = new Map<number, MarketBar>();
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
  readonly closedBar: MarketBar;
  readonly log: (event: DryRunLogEvent) => void;
}): Promise<void> {
  // Dry-run rows model binary Polymarket-style settlement on the
  // canonical Pyth proxy: every closed target candle gets a side, and
  // close == open favors UP.
  const actualUp = closedBar.close >= closedBar.open;
  // Look up the prediction so we know how to score.
  const row = await db
    .selectFrom("dry_run_decisions")
    .select([
      "prediction",
      "order_status",
      "order_limit_price",
      "order_fill_price",
    ])
    .where("id", "=", decisionId)
    .executeTakeFirstOrThrow();
  const predictedUp = row.prediction === "u";
  const won = actualUp === predictedUp ? 1 : 0;
  await db
    .updateTable("dry_run_decisions")
    .set({
      actual_open: closedBar.open,
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
    orderStatus: row.order_status,
    orderLimitPrice: row.order_limit_price,
    orderFillPrice: row.order_fill_price,
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

const fetchNoCandles: FetchCandles = async () => [];
