import { requirePositiveInteger } from "@alea/lib/indicators/shared/series";

export function computeEmaSeries({
  closes,
  period,
}: {
  readonly closes: readonly number[];
  readonly period: number;
}): (number | null)[] {
  requirePositiveInteger({ name: "ema period", value: period });

  const out: (number | null)[] = new Array<number | null>(closes.length).fill(
    null,
  );
  if (closes.length < period) {
    return out;
  }

  let seedSum = 0;
  for (let i = 0; i < period; i += 1) {
    seedSum += closes[i] ?? 0;
  }

  const alpha = 2 / (period + 1);
  let ema = seedSum / period;
  out[period - 1] = ema;
  for (let i = period; i < closes.length; i += 1) {
    const value = closes[i];
    if (value === undefined) {
      continue;
    }
    ema = alpha * value + (1 - alpha) * ema;
    out[i] = ema;
  }
  return out;
}
