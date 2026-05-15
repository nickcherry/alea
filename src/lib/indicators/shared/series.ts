import type { MarketBar } from "@alea/lib/marketSeries/types";

export type NullableNumberSeries = readonly (number | null)[];

export type TimeValuePoint = {
  readonly time: number;
  readonly value: number;
};

export function requirePositiveInteger({
  name,
  value,
}: {
  readonly name: string;
  readonly value: number;
}): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got ${value})`);
  }
}

export function closesFromBars({
  bars,
}: {
  readonly bars: readonly MarketBar[];
}): readonly number[] {
  return bars.map((bar) => bar.close);
}

export function nullableSeriesToTimeValuePoints({
  bars,
  values,
}: {
  readonly bars: readonly MarketBar[];
  readonly values: NullableNumberSeries;
}): readonly TimeValuePoint[] {
  const points: TimeValuePoint[] = [];
  const length = Math.min(bars.length, values.length);
  for (let i = 0; i < length; i += 1) {
    const value = values[i];
    const bar = bars[i];
    if (value === null || value === undefined || bar === undefined) {
      continue;
    }
    points.push({
      time: Math.floor(bar.openTimeMs / 1000),
      value,
    });
  }
  return points;
}

