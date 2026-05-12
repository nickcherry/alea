import { computeEmaSeries } from "@alea/lib/indicators/ema";

export type MacdPoint = {
  readonly macd: number | null;
  readonly signal: number | null;
  readonly histogram: number | null;
};

export function computeMacdSeries({
  closes,
  fast,
  slow,
  signal,
}: {
  readonly closes: readonly number[];
  readonly fast: number;
  readonly slow: number;
  readonly signal: number;
}): readonly MacdPoint[] {
  if (fast <= 0 || slow <= 0 || signal <= 0) {
    throw new Error("macd periods must be > 0");
  }
  if (fast >= slow) {
    throw new Error(`macd fast period must be < slow period`);
  }
  const fastEma = computeEmaSeries({ closes, period: fast });
  const slowEma = computeEmaSeries({ closes, period: slow });
  const macd: (number | null)[] = closes.map((_, i) => {
    const fastValue = fastEma[i];
    const slowValue = slowEma[i];
    if (
      fastValue === null ||
      fastValue === undefined ||
      slowValue === null ||
      slowValue === undefined
    ) {
      return null;
    }
    return fastValue - slowValue;
  });
  const signalLine = computeNullableEma({ values: macd, period: signal });
  return macd.map((value, i) => {
    const signalValue = signalLine[i] ?? null;
    return {
      macd: value,
      signal: signalValue,
      histogram:
        value === null ||
        signalValue === null ||
        value === undefined ||
        signalValue === undefined
          ? null
          : value - signalValue,
    };
  });
}

function computeNullableEma({
  values,
  period,
}: {
  readonly values: readonly (number | null)[];
  readonly period: number;
}): readonly (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(values.length).fill(
    null,
  );
  const alpha = 2 / (period + 1);
  let seedSum = 0;
  let seedCount = 0;
  let ema: number | null = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === null || value === undefined) {
      continue;
    }
    if (ema === null) {
      seedSum += value;
      seedCount += 1;
      if (seedCount === period) {
        ema = seedSum / period;
        out[i] = ema;
      }
      continue;
    }
    ema = alpha * value + (1 - alpha) * ema;
    out[i] = ema;
  }
  return out;
}
