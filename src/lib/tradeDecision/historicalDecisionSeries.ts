import {
  TRADE_DECISION_HYDRATE_BARS,
  tradeDecisionLeadTimeMs,
  type TradeDecisionPeriod,
} from "@alea/constants/tradeDecision";
import { loadAlignedBarSeries } from "@alea/lib/candles/loadAlignedBarSeries";
import { timeframeMs } from "@alea/lib/candles/timeframeMs";
import type { DatabaseClient } from "@alea/lib/db/types";
import {
  alignBarSeries,
  type AlignedBarSeries,
} from "@alea/lib/filters/barSeries";
import type { BarSource, Filter, FilterBar } from "@alea/lib/filters/types";
import type { Asset } from "@alea/types/assets";

const ONE_MINUTE_MS = 60_000;

export type HistoricalDecisionSeries = {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly periodMs: number;
  readonly decisionLeadMs: number;
  readonly hydrateBars: number;
  readonly periodSeries: AlignedBarSeries;
  readonly oneMinuteSeries: AlignedBarSeries;
  readonly pythSyntheticByTargetIndex: readonly (FilterBar | null)[];
  readonly coinbaseSyntheticByTargetIndex: readonly (FilterBar | null)[];
};

export type HistoricalDecisionMoment = {
  readonly target: FilterBar;
  readonly activeOpenTimeMs: number;
  readonly decisionTimeMs: number;
  readonly series: AlignedBarSeries;
};

export async function loadHistoricalDecisionSeries({
  db,
  asset,
  period,
  windowStartMs,
  windowEndExclusiveMs,
  hydrateBars = TRADE_DECISION_HYDRATE_BARS,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly windowStartMs?: number;
  readonly windowEndExclusiveMs?: number;
  readonly hydrateBars?: number;
}): Promise<HistoricalDecisionSeries> {
  const [periodSeries, oneMinuteSeries] = await Promise.all([
    loadAlignedBarSeries({
      db,
      asset,
      timeframe: period,
      windowStartMs,
      windowEndExclusiveMs,
    }),
    loadAlignedBarSeries({
      db,
      asset,
      timeframe: "1m",
      windowStartMs,
      windowEndExclusiveMs,
    }),
  ]);
  return createHistoricalDecisionSeries({
    asset,
    period,
    periodSeries,
    oneMinuteSeries,
    hydrateBars,
  });
}

export function createHistoricalDecisionSeries({
  asset,
  period,
  periodSeries,
  oneMinuteSeries,
  hydrateBars = TRADE_DECISION_HYDRATE_BARS,
}: {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly periodSeries: AlignedBarSeries;
  readonly oneMinuteSeries: AlignedBarSeries;
  readonly hydrateBars?: number;
}): HistoricalDecisionSeries {
  const periodMs = timeframeMs({ timeframe: period });
  const decisionLeadMs = tradeDecisionLeadTimeMs({ period });
  const pythMinuteByOpenTime = indexPythBars({ series: oneMinuteSeries });
  const coinbaseMinuteByOpenTime = indexCoinbaseBars({
    series: oneMinuteSeries,
  });
  const pythSyntheticByTargetIndex: (FilterBar | null)[] = new Array(
    periodSeries.pyth.length,
  ).fill(null);
  const coinbaseSyntheticByTargetIndex: (FilterBar | null)[] = new Array(
    periodSeries.pyth.length,
  ).fill(null);

  for (
    let targetIndex = 1;
    targetIndex < periodSeries.pyth.length;
    targetIndex += 1
  ) {
    const target = periodSeries.pyth[targetIndex]!;
    const active = periodSeries.pyth[targetIndex - 1]!;
    if (target.openTimeMs - active.openTimeMs !== periodMs) {
      continue;
    }
    const decisionTimeMs = target.openTimeMs - decisionLeadMs;
    if (
      decisionTimeMs < active.openTimeMs ||
      decisionTimeMs > target.openTimeMs
    ) {
      continue;
    }

    const pythMinutes = collectCompleteMinuteBars({
      byOpenTime: pythMinuteByOpenTime,
      fromMs: active.openTimeMs,
      untilMs: decisionTimeMs,
    });
    if (pythMinutes === null) {
      continue;
    }
    pythSyntheticByTargetIndex[targetIndex] = synthesizeFromOneMinuteBars({
      openTimeMs: active.openTimeMs,
      open: active.open,
      minuteBars: pythMinutes,
    });

    const coinbaseMinutes = collectCompleteMinuteBars({
      byOpenTime: coinbaseMinuteByOpenTime,
      fromMs: active.openTimeMs,
      untilMs: decisionTimeMs,
    });
    if (coinbaseMinutes !== null) {
      coinbaseSyntheticByTargetIndex[targetIndex] = synthesizeFromOneMinuteBars(
        {
          openTimeMs: active.openTimeMs,
          open:
            periodSeries.coinbase[targetIndex - 1]?.open ??
            coinbaseMinutes[0]?.open ??
            active.open,
          minuteBars: coinbaseMinutes,
        },
      );
    }
  }

  return {
    asset,
    period,
    periodMs,
    decisionLeadMs,
    hydrateBars,
    periodSeries,
    oneMinuteSeries,
    pythSyntheticByTargetIndex,
    coinbaseSyntheticByTargetIndex,
  };
}

export function buildHistoricalDecisionMoment({
  series,
  targetIndex,
}: {
  readonly series: HistoricalDecisionSeries;
  readonly targetIndex: number;
}): HistoricalDecisionMoment | null {
  const target = series.periodSeries.pyth[targetIndex];
  const synthetic = series.pythSyntheticByTargetIndex[targetIndex];
  if (target === undefined || synthetic === null || synthetic === undefined) {
    return null;
  }
  const decisionSeries = buildHistoricalDecisionAlignedSeries({
    series,
    targetIndex,
  });
  if (decisionSeries === null) {
    return null;
  }
  return {
    target,
    activeOpenTimeMs: synthetic.openTimeMs,
    decisionTimeMs: target.openTimeMs - series.decisionLeadMs,
    series: decisionSeries,
  };
}

export function buildHistoricalDecisionAlignedSeries({
  series,
  targetIndex,
  maxBars = series.hydrateBars,
}: {
  readonly series: HistoricalDecisionSeries;
  readonly targetIndex: number;
  readonly maxBars?: number;
}): AlignedBarSeries | null {
  const activeIndex = targetIndex - 1;
  const synthetic = series.pythSyntheticByTargetIndex[targetIndex];
  if (activeIndex < 0 || synthetic === null || synthetic === undefined) {
    return null;
  }
  const start = Math.max(0, activeIndex - (maxBars - 1));
  const pyth = [
    ...series.periodSeries.pyth.slice(start, activeIndex),
    synthetic,
  ];
  const coinbase: FilterBar[] = [];
  for (let index = start; index < activeIndex; index += 1) {
    const bar = series.periodSeries.coinbase[index];
    if (bar !== null && bar !== undefined) {
      coinbase.push(bar);
    }
  }
  const coinbaseSynthetic = series.coinbaseSyntheticByTargetIndex[targetIndex];
  if (coinbaseSynthetic !== null && coinbaseSynthetic !== undefined) {
    coinbase.push(coinbaseSynthetic);
  }
  return alignBarSeries({ pyth, coinbase });
}

export function selectHistoricalDecisionFilterWindow({
  series,
  filter,
  targetIndex,
  requiredBars,
}: {
  readonly series: HistoricalDecisionSeries;
  readonly filter: Pick<Filter<unknown>, "barSource">;
  readonly targetIndex: number;
  readonly requiredBars: number;
}): readonly FilterBar[] | null {
  const source = filter.barSource;
  const synthetic =
    source === "pyth"
      ? series.pythSyntheticByTargetIndex[targetIndex]
      : series.coinbaseSyntheticByTargetIndex[targetIndex];
  if (synthetic === null || synthetic === undefined) {
    return null;
  }
  const activeIndex = targetIndex - 1;
  const start = activeIndex - (requiredBars - 1);
  if (start < 0) {
    return null;
  }
  const prior = selectPriorBars({
    series,
    source,
    start,
    endExclusive: activeIndex,
  });
  if (prior === null) {
    return null;
  }
  return [...prior, synthetic];
}

function selectPriorBars({
  series,
  source,
  start,
  endExclusive,
}: {
  readonly series: HistoricalDecisionSeries;
  readonly source: BarSource;
  readonly start: number;
  readonly endExclusive: number;
}): readonly FilterBar[] | null {
  if (source === "pyth") {
    return series.periodSeries.pyth.slice(start, endExclusive);
  }
  const bars: FilterBar[] = [];
  for (let index = start; index < endExclusive; index += 1) {
    const bar = series.periodSeries.coinbase[index];
    if (bar === null || bar === undefined) {
      return null;
    }
    bars.push(bar);
  }
  return bars;
}

function collectCompleteMinuteBars({
  byOpenTime,
  fromMs,
  untilMs,
}: {
  readonly byOpenTime: ReadonlyMap<number, FilterBar>;
  readonly fromMs: number;
  readonly untilMs: number;
}): readonly FilterBar[] | null {
  const bars: FilterBar[] = [];
  for (
    let openTimeMs = fromMs;
    openTimeMs < untilMs;
    openTimeMs += ONE_MINUTE_MS
  ) {
    const bar = byOpenTime.get(openTimeMs);
    if (bar === undefined) {
      return null;
    }
    bars.push(bar);
  }
  return bars;
}

function synthesizeFromOneMinuteBars({
  openTimeMs,
  open,
  minuteBars,
}: {
  readonly openTimeMs: number;
  readonly open: number;
  readonly minuteBars: readonly FilterBar[];
}): FilterBar {
  let high = open;
  let low = open;
  let close = open;
  let volume = 0;
  for (const bar of minuteBars) {
    high = Math.max(high, bar.high);
    low = Math.min(low, bar.low);
    close = bar.close;
    volume += bar.volume;
  }
  return { openTimeMs, open, high, low, close, volume };
}

function indexPythBars({
  series,
}: {
  readonly series: AlignedBarSeries;
}): ReadonlyMap<number, FilterBar> {
  const out = new Map<number, FilterBar>();
  for (const bar of series.pyth) {
    out.set(bar.openTimeMs, bar);
  }
  return out;
}

function indexCoinbaseBars({
  series,
}: {
  readonly series: AlignedBarSeries;
}): ReadonlyMap<number, FilterBar> {
  const out = new Map<number, FilterBar>();
  for (const bar of series.coinbase) {
    if (bar !== null) {
      out.set(bar.openTimeMs, bar);
    }
  }
  return out;
}
