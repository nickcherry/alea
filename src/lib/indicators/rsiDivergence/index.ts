import {
  findPivotHighs,
  findPivotLows,
  type PivotPoint,
} from "@alea/lib/indicators/shared/pivots";
import { requirePositiveInteger } from "@alea/lib/indicators/shared/series";
import type { MarketBar } from "@alea/lib/marketSeries/types";

export type RsiDivergenceKind =
  | "regular_bullish"
  | "hidden_bullish"
  | "regular_bearish"
  | "hidden_bearish";

export type RsiDivergenceSignal = {
  readonly kind: RsiDivergenceKind;
  readonly pivotIndex: number;
  readonly previousPivotIndex: number;
  readonly confirmedIndex: number;
  readonly price: number;
  readonly previousPrice: number;
  readonly rsi: number;
  readonly previousRsi: number;
};

export type ComputeRsiDivergenceParams = {
  readonly bars: readonly MarketBar[];
  readonly rsi: readonly (number | null)[];
  readonly leftBars?: number;
  readonly rightBars?: number;
  readonly rangeLower?: number;
  readonly rangeUpper?: number;
};

export function computeRsiDivergenceSignals({
  bars,
  rsi,
  leftBars = 5,
  rightBars = 5,
  rangeLower = 5,
  rangeUpper = 60,
}: ComputeRsiDivergenceParams): readonly RsiDivergenceSignal[] {
  requirePositiveInteger({ name: "leftBars", value: leftBars });
  requirePositiveInteger({ name: "rightBars", value: rightBars });
  requireNonNegativeInteger({ name: "rangeLower", value: rangeLower });
  requireNonNegativeInteger({ name: "rangeUpper", value: rangeUpper });
  if (rangeLower > rangeUpper) {
    throw new Error("rangeLower must be <= rangeUpper");
  }

  const length = Math.min(bars.length, rsi.length);
  const boundedBars = bars.slice(0, length);
  const boundedRsi = rsi.slice(0, length);
  const lowSignals = divergenceFromPivots({
    bars: boundedBars,
    rsi: boundedRsi,
    pivots: findPivotLows({ values: boundedRsi, leftBars, rightBars }),
    rightBars,
    rangeLower,
    rangeUpper,
    priceAt: (bar) => bar.low,
    regularKind: "regular_bullish",
    hiddenKind: "hidden_bullish",
    isRegular: ({ price, previousPrice, rsiValue, previousRsi }) =>
      price < previousPrice && rsiValue > previousRsi,
    isHidden: ({ price, previousPrice, rsiValue, previousRsi }) =>
      price > previousPrice && rsiValue < previousRsi,
  });
  const highSignals = divergenceFromPivots({
    bars: boundedBars,
    rsi: boundedRsi,
    pivots: findPivotHighs({ values: boundedRsi, leftBars, rightBars }),
    rightBars,
    rangeLower,
    rangeUpper,
    priceAt: (bar) => bar.high,
    regularKind: "regular_bearish",
    hiddenKind: "hidden_bearish",
    isRegular: ({ price, previousPrice, rsiValue, previousRsi }) =>
      price > previousPrice && rsiValue < previousRsi,
    isHidden: ({ price, previousPrice, rsiValue, previousRsi }) =>
      price < previousPrice && rsiValue > previousRsi,
  });

  return [...lowSignals, ...highSignals].sort(
    (a, b) => a.pivotIndex - b.pivotIndex || a.kind.localeCompare(b.kind),
  );
}

function divergenceFromPivots({
  bars,
  rsi,
  pivots,
  rightBars,
  rangeLower,
  rangeUpper,
  priceAt,
  regularKind,
  hiddenKind,
  isRegular,
  isHidden,
}: {
  readonly bars: readonly MarketBar[];
  readonly rsi: readonly (number | null)[];
  readonly pivots: readonly PivotPoint[];
  readonly rightBars: number;
  readonly rangeLower: number;
  readonly rangeUpper: number;
  readonly priceAt: (bar: MarketBar) => number;
  readonly regularKind: RsiDivergenceKind;
  readonly hiddenKind: RsiDivergenceKind;
  readonly isRegular: (values: DivergenceValues) => boolean;
  readonly isHidden: (values: DivergenceValues) => boolean;
}): readonly RsiDivergenceSignal[] {
  const signals: RsiDivergenceSignal[] = [];
  for (let i = 1; i < pivots.length; i += 1) {
    const pivot = pivots[i]!;
    const previous = previousPivotInPineRange({
      pivots,
      pivotIndex: i,
      rangeLower,
      rangeUpper,
    });
    if (previous === null) {
      continue;
    }
    const bar = bars[pivot.index];
    const previousBar = bars[previous.index];
    const rsiValue = rsi[pivot.index];
    const previousRsi = rsi[previous.index];
    if (
      bar === undefined ||
      previousBar === undefined ||
      rsiValue === null ||
      rsiValue === undefined ||
      previousRsi === null ||
      previousRsi === undefined
    ) {
      continue;
    }
    const values = {
      price: priceAt(bar),
      previousPrice: priceAt(previousBar),
      rsiValue,
      previousRsi,
    };
    const common = {
      pivotIndex: pivot.index,
      previousPivotIndex: previous.index,
      confirmedIndex: pivot.index + rightBars,
      price: values.price,
      previousPrice: values.previousPrice,
      rsi: values.rsiValue,
      previousRsi: values.previousRsi,
    };
    if (isRegular(values)) {
      signals.push({ kind: regularKind, ...common });
    }
    if (isHidden(values)) {
      signals.push({ kind: hiddenKind, ...common });
    }
  }
  return signals;
}

function previousPivotInPineRange({
  pivots,
  pivotIndex,
  rangeLower,
  rangeUpper,
}: {
  readonly pivots: readonly PivotPoint[];
  readonly pivotIndex: number;
  readonly rangeLower: number;
  readonly rangeUpper: number;
}): PivotPoint | null {
  const pivot = pivots[pivotIndex];
  const previous = pivots[pivotIndex - 1];
  if (pivot === undefined || previous === undefined) {
    return null;
  }
  const barsSincePreviousFound = pivot.index - previous.index - 1;
  return rangeLower <= barsSincePreviousFound &&
    barsSincePreviousFound <= rangeUpper
    ? previous
    : null;
}

type DivergenceValues = {
  readonly price: number;
  readonly previousPrice: number;
  readonly rsiValue: number;
  readonly previousRsi: number;
};

function requireNonNegativeInteger({
  name,
  value,
}: {
  readonly name: string;
  readonly value: number;
}): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
