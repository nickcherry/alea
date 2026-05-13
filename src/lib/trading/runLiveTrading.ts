import "@alea/lib/filters/all";

import {
  TRADE_DECISION_DEFAULT_PERIODS,
  TRADE_DECISION_HYDRATE_BARS,
  TRADE_DECISION_LEAD_TIME_MS,
  type TradeDecisionPeriod,
} from "@alea/constants/tradeDecision";
import { LIVE_TRADING_MARKET_DISCOVERY_LEAD_MS } from "@alea/constants/trading";
import { listCommitteeCandidates } from "@alea/lib/committee/runCommittee";
import {
  candidateRosterKey,
  type CommitteeRoster,
  loadCommitteeRoster,
} from "@alea/lib/committee/selection/loadCommitteeRoster";
import type { DatabaseClient } from "@alea/lib/db/types";
import type { Candidate, FilterBar } from "@alea/lib/filters/types";
import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import { getPolymarketClobClient } from "@alea/lib/polymarket/getPolymarketClobClient";
import type { MarketRegime } from "@alea/lib/regime/types";
import {
  type FetchCandles,
  hydrateTradeDecisionCandleState,
  refreshTradeDecisionCandleState,
  type TradeDecisionCandleState,
} from "@alea/lib/tradeDecision/candleState";
import { evaluateTradeDecision } from "@alea/lib/tradeDecision/evaluateTradeDecision";
import { createMarketEventPythCandleFetcher } from "@alea/lib/tradeDecision/marketEventCandles";
import {
  createLiveOrderExecutor,
  type LiveTradingMarketLogEvent,
  type LiveTradingOrderLogEvent,
} from "@alea/lib/trading/liveOrderExecution";
import { createPolymarketMarketDiscoveryCache } from "@alea/lib/trading/vendor/polymarket/marketDiscoveryCache";
import type { Asset } from "@alea/types/assets";

export type LiveTradingHandle = {
  readonly stop: () => Promise<void>;
};

export type LiveTradingOptions = {
  readonly db: DatabaseClient;
  readonly assets: readonly Asset[];
  readonly periods?: readonly TradeDecisionPeriod[];
  readonly log: (event: LiveTradingLogEvent) => void;
};

export type LiveTradingLogEvent =
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
      readonly confidence: number | null;
    }
  | LiveTradingOrderLogEvent
  | LiveTradingMarketLogEvent
  | { readonly kind: "error"; readonly message: string };

export async function runLiveTrading({
  db,
  assets,
  periods = TRADE_DECISION_DEFAULT_PERIODS,
  log,
}: LiveTradingOptions): Promise<LiveTradingHandle> {
  const selectedPeriods: TradeDecisionPeriod[] =
    periods.length === 0
      ? [...TRADE_DECISION_DEFAULT_PERIODS]
      : Array.from(new Set(periods));
  const statesByPeriod = new Map<
    TradeDecisionPeriod,
    TradeDecisionCandleState[]
  >();
  for (const period of selectedPeriods) {
    statesByPeriod.set(period, []);
  }
  const fetchCandles = createMarketEventPythCandleFetcher({ db });
  for (const asset of assets) {
    for (const period of selectedPeriods) {
      const state = await hydrateTradeDecisionCandleState({
        asset,
        period,
        limit: TRADE_DECISION_HYDRATE_BARS,
        fetchCandles,
      });
      statesByPeriod.get(period)?.push(state);
      log({ kind: "hydrated", asset, period, barCount: state.bars.length });
    }
  }

  const candidates = listCommitteeCandidates();
  const roster = await loadCommitteeRoster({ db });
  logRoster({ roster, log });
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

  const client = await getPolymarketClobClient();
  const marketDiscovery = createPolymarketMarketDiscoveryCache({
    retryMs: 2_000,
  });
  const orderExecutor = createLiveOrderExecutor({
    client,
    marketDiscovery,
    log,
  });
  let running = true;
  log({ kind: "ready" });

  const tick = async (): Promise<void> => {
    while (running) {
      try {
        const now = Date.now();
        orderExecutor.warm({
          assets,
          timeframes: selectedPeriods,
          nowMs: now,
          discoveryLeadMs: LIVE_TRADING_MARKET_DISCOVERY_LEAD_MS,
        });
        let nextFireTime = now + 1000;
        for (const period of selectedPeriods) {
          const periodMs = resolutionTimeframeStepMs({ timeframe: period });
          const nextBoundary = Math.ceil(now / periodMs) * periodMs;
          const fireTime = nextBoundary - TRADE_DECISION_LEAD_TIME_MS;
          nextFireTime = Math.min(nextFireTime, fireTime);
          if (now < fireTime) {
            continue;
          }
          for (const state of statesByPeriod.get(period) ?? []) {
            if (state.lastPredictedBoundary >= nextBoundary) {
              continue;
            }
            const refreshed = await refreshStateForDecision({
              state,
              now,
              fetchCandles,
              log,
            });
            if (refreshed === null) {
              continue;
            }
            state.lastPredictedBoundary = nextBoundary;
            await makeLiveDecision({
              state,
              targetTsMs: nextBoundary,
              bars: refreshed.barsForDecision,
              synthBar: refreshed.syntheticBar,
              roster,
              candidatesByKey,
              orderExecutor,
              log,
            });
          }
        }
        const sleepMs = Math.max(100, Math.min(nextFireTime - now + 1, 1000));
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
      await orderExecutor.stop();
    },
  };
}

async function refreshStateForDecision({
  state,
  now,
  fetchCandles,
  log,
}: {
  readonly state: TradeDecisionCandleState;
  readonly now: number;
  readonly fetchCandles: FetchCandles;
  readonly log: (event: LiveTradingLogEvent) => void;
}): Promise<{
  readonly barsForDecision: readonly FilterBar[];
  readonly syntheticBar: FilterBar;
} | null> {
  try {
    const refreshed = await refreshTradeDecisionCandleState({
      state,
      nowMs: now,
      limit: TRADE_DECISION_HYDRATE_BARS,
      fetchCandles,
    });
    if (refreshed.syntheticBar === null || refreshed.barsForDecision === null) {
      const reason =
        refreshed.priceAgeMs === null
          ? "missing latest Pyth price"
          : `latest Pyth price stale (${refreshed.priceAgeMs}ms old)`;
      log({
        kind: "error",
        message: `skip decision ${state.period}/${state.asset}: ${reason}`,
      });
      return null;
    }
    return {
      barsForDecision: refreshed.barsForDecision,
      syntheticBar: refreshed.syntheticBar,
    };
  } catch (e) {
    log({
      kind: "error",
      message: `candle refresh failed ${state.period}/${state.asset}: ${String(e)}`,
    });
    return null;
  }
}

async function makeLiveDecision({
  state,
  targetTsMs,
  bars,
  synthBar,
  roster,
  candidatesByKey,
  orderExecutor,
  log,
}: {
  readonly state: TradeDecisionCandleState;
  readonly targetTsMs: number;
  readonly bars: readonly FilterBar[];
  readonly synthBar: FilterBar;
  readonly roster: CommitteeRoster;
  readonly candidatesByKey: ReadonlyMap<string, Candidate>;
  readonly orderExecutor: ReturnType<typeof createLiveOrderExecutor>;
  readonly log: (event: LiveTradingLogEvent) => void;
}): Promise<void> {
  const evaluated = evaluateTradeDecision({
    asset: state.asset,
    period: state.period,
    bars,
    roster,
    candidatesByKey,
  });
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
    confidence: evaluated.orderConfidence,
  });
  if (evaluated.prediction === null) {
    return;
  }
  await orderExecutor.scheduleOrder({
    asset: state.asset,
    period: state.period,
    prediction: evaluated.prediction,
    targetTsMs,
    confidence: evaluated.orderConfidence,
  });
}

function logRoster({
  roster,
  log,
}: {
  readonly roster: CommitteeRoster;
  readonly log: (event: LiveTradingLogEvent) => void;
}): void {
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
