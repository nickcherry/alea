import {
  nextTradeDecisionFireTimeMs,
  resolveTradeDecisionMarkets,
  TRADE_DECISION_DECISION_SOURCE,
  TRADE_DECISION_MAX_DECISION_DURATION_MS,
  tradeDecisionFireTimeMs,
  tradeDecisionHydrateBars,
  type TradeDecisionMarket,
  tradeDecisionMarketPeriods,
  type TradeDecisionPeriod,
  tradeDecisionTargetOpenTimeMs,
} from "@alea/constants/tradeDecision";
import {
  LIVE_TRADING_MARKET_DISCOVERY_LEAD_MS,
} from "@alea/constants/trading";
import type { DatabaseClient } from "@alea/lib/db/types";
import { evaluateCandidateTradeDecision } from "@alea/lib/filters/evaluateCandidates";
import type { AlignedMarketSeries } from "@alea/lib/marketSeries/align";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import { getPolymarketClobClient } from "@alea/lib/polymarket/getPolymarketClobClient";
import {
  type FetchCandles,
  hydrateTradeDecisionCandleState,
  refreshTradeDecisionCandleState,
  type TradeDecisionCandleState,
} from "@alea/lib/tradeDecision/candleState";
import { createMarketEventPythCandleFetcher } from "@alea/lib/tradeDecision/marketEventCandles";
import { createLiveDecisionTelegramNotifier } from "@alea/lib/trading/liveDecisionTelegram";
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
  readonly assets?: readonly Asset[];
  readonly markets?: readonly TradeDecisionMarket[];
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
      readonly priceAgeMs: number | null;
      readonly sourceCount: number;
      readonly up: number;
      readonly down: number;
      readonly abstain: number;
      readonly reasoning: string | null;
    }
  | LiveTradingOrderLogEvent
  | LiveTradingMarketLogEvent
  | { readonly kind: "error"; readonly message: string };

type DueLiveDecision = {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly targetTsMs: number;
  readonly promise: Promise<void>;
};

export async function runLiveTrading({
  db,
  assets,
  markets,
  periods,
  log,
}: LiveTradingOptions): Promise<LiveTradingHandle> {
  const selectedMarkets = resolveTradeDecisionMarkets({
    markets,
    assets,
    periods,
  });
  const selectedPeriods = tradeDecisionMarketPeriods({
    markets: selectedMarkets,
  });
  const statesByPeriod = new Map<
    TradeDecisionPeriod,
    TradeDecisionCandleState[]
  >();
  for (const period of selectedPeriods) {
    statesByPeriod.set(period, []);
  }
  const fetchCandles = createMarketEventPythCandleFetcher({ db });
  for (const { asset, period } of selectedMarkets) {
    const hydrateBars = tradeDecisionHydrateBars({ period });
    const state = await hydrateTradeDecisionCandleState({
      asset,
      period,
      limit: hydrateBars,
      fetchCandles,
      fetchCoinbaseBarsForHydrate: fetchNoCandles,
    });
    statesByPeriod.get(period)?.push(state);
    log({ kind: "hydrated", asset, period, barCount: state.bars.length });
  }

  log({
    kind: "predictor",
    source: TRADE_DECISION_DECISION_SOURCE,
  });

  const client = await getPolymarketClobClient();
  const marketDiscovery = createPolymarketMarketDiscoveryCache({
    retryMs: 2_000,
  });
  const telegramNotifier = createLiveDecisionTelegramNotifier({ log });
  const orderLog = (
    event:
      | LiveTradingOrderLogEvent
      | LiveTradingMarketLogEvent
      | { readonly kind: "error"; readonly message: string },
  ) => {
    log(event);
    if (event.kind === "live-order") {
      void telegramNotifier.handleOrderEvent(event);
    }
  };
  const orderExecutor = createLiveOrderExecutor({
    client,
    marketDiscovery,
    log: orderLog,
  });
  let running = true;
  log({ kind: "ready" });

  const tick = async (): Promise<void> => {
    while (running) {
      try {
        const now = Date.now();
        orderExecutor.warm({
          markets: selectedMarkets,
          nowMs: now,
          discoveryLeadMs: LIVE_TRADING_MARKET_DISCOVERY_LEAD_MS,
        });
        let nextFireTime = now + 1000;
        const dueDecisions: DueLiveDecision[] = [];
        for (const period of selectedPeriods) {
          const targetTsMs = tradeDecisionTargetOpenTimeMs({
            period,
            nowMs: now,
          });
          const fireTime = tradeDecisionFireTimeMs({ period, targetTsMs });
          nextFireTime = Math.min(
            nextFireTime,
            nextTradeDecisionFireTimeMs({ period, nowMs: now }),
          );
          if (now < fireTime) {
            continue;
          }
          for (const state of statesByPeriod.get(period) ?? []) {
            if (state.lastPredictedBoundary >= targetTsMs) {
              continue;
            }
            dueDecisions.push({
              asset: state.asset,
              period: state.period,
              targetTsMs,
              promise: processDueLiveDecision({
                state,
                now,
                fetchCandles,
                targetTsMs,
                orderExecutor,
                telegramNotifier,
                log,
              }),
            });
          }
        }
        await waitForDueLiveDecisions({
          decisions: dueDecisions,
          timeoutMs: TRADE_DECISION_MAX_DECISION_DURATION_MS,
          log,
        });
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

export async function waitForDueLiveDecisions({
  decisions,
  timeoutMs,
  log,
}: {
  readonly decisions: readonly DueLiveDecision[];
  readonly timeoutMs: number;
  readonly log: (event: LiveTradingLogEvent) => void;
}): Promise<void> {
  await Promise.all(
    decisions.map((decision) =>
      waitForDueLiveDecision({
        decision,
        timeoutMs,
        log,
      }),
    ),
  );
}

function waitForDueLiveDecision({
  decision,
  timeoutMs,
  log,
}: {
  readonly decision: DueLiveDecision;
  readonly timeoutMs: number;
  readonly log: (event: LiveTradingLogEvent) => void;
}): Promise<void> {
  if (timeoutMs <= 0) {
    logDecisionTimeout({ decision, timeoutMs, log });
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      logDecisionTimeout({ decision, timeoutMs, log });
      resolve();
    }, timeoutMs);

    decision.promise.then(
      () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        log({
          kind: "error",
          message: `decision failed ${decision.period}/${decision.asset}: ${String(error)}`,
        });
        resolve();
      },
    );
  });
}

function logDecisionTimeout({
  decision,
  timeoutMs,
  log,
}: {
  readonly decision: DueLiveDecision;
  readonly timeoutMs: number;
  readonly log: (event: LiveTradingLogEvent) => void;
}): void {
  log({
    kind: "error",
    message:
      `decision timed out ${decision.period}/${decision.asset}` +
      ` target=${new Date(decision.targetTsMs).toISOString()}` +
      ` after ${timeoutMs}ms; scheduler continuing`,
  });
}

async function processDueLiveDecision({
  state,
  now,
  fetchCandles,
  targetTsMs,
  orderExecutor,
  telegramNotifier,
  log,
}: {
  readonly state: TradeDecisionCandleState;
  readonly now: number;
  readonly fetchCandles: FetchCandles;
  readonly targetTsMs: number;
  readonly orderExecutor: ReturnType<typeof createLiveOrderExecutor>;
  readonly telegramNotifier: ReturnType<
    typeof createLiveDecisionTelegramNotifier
  >;
  readonly log: (event: LiveTradingLogEvent) => void;
}): Promise<void> {
  try {
    const refreshed = await refreshStateForDecision({
      state,
      now,
      fetchCandles,
      log,
    });
    if (refreshed === null) {
      return;
    }
    await makeLiveDecision({
      state,
      targetTsMs,
      series: refreshed.seriesForDecision,
      synthBar: refreshed.syntheticBar,
      priceAgeMs: refreshed.priceAgeMs,
      orderExecutor,
      telegramNotifier,
      log,
    });
  } catch (e) {
    log({
      kind: "error",
      message: `decision failed ${state.period}/${state.asset}: ${String(e)}`,
    });
  }
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
  readonly seriesForDecision: AlignedMarketSeries;
  readonly syntheticBar: MarketBar;
  readonly priceAgeMs: number | null;
} | null> {
  try {
    const refreshed = await refreshTradeDecisionCandleState({
      state,
      nowMs: now,
      limit: tradeDecisionHydrateBars({ period: state.period }),
      fetchCandles,
      fetchCoinbaseBarsForRefresh: fetchNoCandles,
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
      return null;
    }
    return {
      seriesForDecision: refreshed.seriesForDecision,
      syntheticBar: refreshed.syntheticBar,
      priceAgeMs: refreshed.priceAgeMs,
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
  series,
  synthBar,
  priceAgeMs,
  orderExecutor,
  telegramNotifier,
  log,
}: {
  readonly state: TradeDecisionCandleState;
  readonly targetTsMs: number;
  readonly series: AlignedMarketSeries;
  readonly synthBar: MarketBar;
  readonly priceAgeMs: number | null;
  readonly orderExecutor: ReturnType<typeof createLiveOrderExecutor>;
  readonly telegramNotifier: ReturnType<
    typeof createLiveDecisionTelegramNotifier
  >;
  readonly log: (event: LiveTradingLogEvent) => void;
}): Promise<void> {
  state.lastPredictedBoundary = targetTsMs;
  const evaluated = evaluateCandidateTradeDecision({
    context: {
      asset: state.asset,
      period: state.period,
      targetTsMs,
      series,
    },
  });
  log({
    kind: "decision",
    asset: state.asset,
    period: state.period,
    tsMs: targetTsMs,
    prediction: evaluated.prediction,
    decision: evaluated.decision,
    synthClose: synthBar.close,
    priceAgeMs,
    sourceCount: evaluated.votes.length,
    up: evaluated.up,
    down: evaluated.down,
    abstain: evaluated.neutral,
    reasoning: evaluated.summary,
  });
  if (evaluated.prediction === null) {
    return;
  }
  telegramNotifier.trackDecision({
    asset: state.asset,
    period: state.period,
    targetTsMs,
    prediction: evaluated.prediction,
    reasoning: evaluated.summary,
  });
  if (
    isLiveDecisionTooLateForOrder({
      period: state.period,
      targetTsMs,
      nowMs: Date.now(),
    })
  ) {
    log({
      kind: "error",
      message:
        `skip stale order ${state.period}/${state.asset}` +
        ` target=${new Date(targetTsMs).toISOString()}`,
    });
    return;
  }
  await orderExecutor.scheduleOrder({
    asset: state.asset,
    period: state.period,
    prediction: evaluated.prediction,
    targetTsMs,
    confidence: null,
  });
}

export function isLiveDecisionTooLateForOrder({
  period,
  targetTsMs,
  nowMs,
}: {
  readonly period: TradeDecisionPeriod;
  readonly targetTsMs: number;
  readonly nowMs: number;
}): boolean {
  return nowMs >= targetTsMs + resolutionTimeframeStepMs({ timeframe: period });
}

const fetchNoCandles: FetchCandles = async () => [];
