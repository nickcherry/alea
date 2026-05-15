import {
  resolveTradeDecisionMarkets,
  tradeDecisionHydrateBars,
  tradeDecisionLeadTimeMs,
  type TradeDecisionMarket,
  tradeDecisionMarketPeriods,
  type TradeDecisionPeriod,
} from "@alea/constants/tradeDecision";
import { LIVE_TRADING_MARKET_DISCOVERY_LEAD_MS } from "@alea/constants/trading";
import type { DatabaseClient } from "@alea/lib/db/types";
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
import { evaluateOpenAiChartTradeDecision } from "@alea/lib/tradeDecision/openAiChartDecision";
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
      readonly source: "openai_chart";
    }
  | {
      readonly kind: "decision";
      readonly asset: Asset;
      readonly period: TradeDecisionPeriod;
      readonly tsMs: number;
      readonly prediction: "u" | "d";
      readonly synthClose: number;
      readonly priceAgeMs: number | null;
      readonly sourceCount: number;
      readonly up: number;
      readonly down: number;
      readonly abstain: number;
      readonly model: string | null;
      readonly reasoning: string | null;
    }
  | LiveTradingOrderLogEvent
  | LiveTradingMarketLogEvent
  | { readonly kind: "error"; readonly message: string };

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
    source: "openai_chart",
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
        const dueDecisions: Promise<void>[] = [];
        for (const period of selectedPeriods) {
          const periodMs = resolutionTimeframeStepMs({ timeframe: period });
          const nextBoundary = Math.ceil(now / periodMs) * periodMs;
          const fireTime = nextBoundary - tradeDecisionLeadTimeMs({ period });
          nextFireTime = Math.min(nextFireTime, fireTime);
          if (now < fireTime) {
            continue;
          }
          for (const state of statesByPeriod.get(period) ?? []) {
            if (state.lastPredictedBoundary >= nextBoundary) {
              continue;
            }
            dueDecisions.push(
              processDueLiveDecision({
                state,
                now,
                fetchCandles,
                targetTsMs: nextBoundary,
                orderExecutor,
                telegramNotifier,
                log,
              }),
            );
          }
        }
        await Promise.all(dueDecisions);
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
  const evaluated = await evaluateOpenAiChartTradeDecision({
    asset: state.asset,
    period: state.period,
    targetTsMs,
    series,
  });
  log({
    kind: "decision",
    asset: state.asset,
    period: state.period,
    tsMs: targetTsMs,
    prediction: evaluated.prediction,
    synthClose: synthBar.close,
    priceAgeMs,
    sourceCount: 1,
    up: evaluated.up,
    down: evaluated.down,
    abstain: evaluated.abstain,
    model: evaluated.model,
    reasoning: evaluated.reasoning,
  });
  telegramNotifier.trackDecision({
    asset: state.asset,
    period: state.period,
    targetTsMs,
    prediction: evaluated.prediction,
    imagePath: evaluated.imagePath,
    reasoning: evaluated.reasoning,
  });
  await orderExecutor.scheduleOrder({
    asset: state.asset,
    period: state.period,
    prediction: evaluated.prediction,
    targetTsMs,
    confidence: null,
  });
}

const fetchNoCandles: FetchCandles = async () => [];
