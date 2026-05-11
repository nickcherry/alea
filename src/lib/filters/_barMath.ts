import type { FilterBar } from "@alea/lib/filters/types";

export type BodyDirection = "up" | "down";

export function barRange(bar: FilterBar): number {
  return bar.high - bar.low;
}

export function bodySize(bar: FilterBar): number {
  return Math.abs(bar.close - bar.open);
}

export function bodyFraction(bar: FilterBar): number | null {
  const range = barRange(bar);
  if (range <= 0) {
    return null;
  }
  return bodySize(bar) / range;
}

export function bodyDirection(bar: FilterBar): BodyDirection | null {
  if (bar.close > bar.open) {
    return "up";
  }
  if (bar.close < bar.open) {
    return "down";
  }
  return null;
}

export function closeLocation(bar: FilterBar): number | null {
  const range = barRange(bar);
  if (range <= 0) {
    return null;
  }
  return (bar.close - bar.low) / range;
}

export function highestHigh({
  bars,
  start,
  endExclusive,
}: {
  readonly bars: readonly FilterBar[];
  readonly start: number;
  readonly endExclusive: number;
}): number | null {
  if (start < 0 || endExclusive > bars.length || start >= endExclusive) {
    return null;
  }
  let high = -Infinity;
  for (let i = start; i < endExclusive; i += 1) {
    const bar = bars[i];
    if (bar === undefined) {
      return null;
    }
    high = Math.max(high, bar.high);
  }
  return Number.isFinite(high) ? high : null;
}

export function lowestLow({
  bars,
  start,
  endExclusive,
}: {
  readonly bars: readonly FilterBar[];
  readonly start: number;
  readonly endExclusive: number;
}): number | null {
  if (start < 0 || endExclusive > bars.length || start >= endExclusive) {
    return null;
  }
  let low = Infinity;
  for (let i = start; i < endExclusive; i += 1) {
    const bar = bars[i];
    if (bar === undefined) {
      return null;
    }
    low = Math.min(low, bar.low);
  }
  return Number.isFinite(low) ? low : null;
}

export function meanVolume({
  bars,
  start,
  endExclusive,
}: {
  readonly bars: readonly FilterBar[];
  readonly start: number;
  readonly endExclusive: number;
}): number | null {
  if (start < 0 || endExclusive > bars.length || start >= endExclusive) {
    return null;
  }
  let sum = 0;
  for (let i = start; i < endExclusive; i += 1) {
    const bar = bars[i];
    if (bar === undefined) {
      return null;
    }
    sum += bar.volume;
  }
  const length = endExclusive - start;
  return length > 0 ? sum / length : null;
}

export function percentileRank({
  values,
  value,
}: {
  readonly values: readonly number[];
  readonly value: number;
}): number | null {
  if (values.length === 0) {
    return null;
  }
  let count = 0;
  for (const v of values) {
    if (v <= value) {
      count += 1;
    }
  }
  return (100 * count) / values.length;
}

