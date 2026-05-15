import { requirePositiveInteger } from "@alea/lib/indicators/shared/series";

export function computeSmaSeries({
  closes,
  period,
}: {
  readonly closes: readonly number[];
  readonly period: number;
}): (number | null)[] {
  requirePositiveInteger({ name: "sma period", value: period });

  const out: (number | null)[] = new Array<number | null>(closes.length).fill(
    null,
  );
  let sum = 0;
  for (let i = 0; i < closes.length; i += 1) {
    const value = closes[i];
    if (value === undefined) {
      continue;
    }
    sum += value;
    if (i >= period) {
      sum -= closes[i - period] ?? 0;
    }
    if (i >= period - 1) {
      out[i] = sum / period;
    }
  }
  return out;
}

