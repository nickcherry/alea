import { requirePositiveInteger } from "@alea/lib/indicators/shared/series";

export function computeWilderRsiSeries({
  closes,
  period,
}: {
  readonly closes: readonly number[];
  readonly period: number;
}): (number | null)[] {
  requirePositiveInteger({ name: "rsi period", value: period });

  const out: (number | null)[] = new Array<number | null>(closes.length).fill(
    null,
  );
  if (closes.length <= period) {
    return out;
  }

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const previous = closes[i - 1];
    const current = closes[i];
    if (previous === undefined || current === undefined) {
      return out;
    }
    const diff = current - previous;
    if (diff >= 0) {
      gainSum += diff;
    } else {
      lossSum -= diff;
    }
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiOf({ avgGain, avgLoss });

  for (let i = period + 1; i < closes.length; i += 1) {
    const previous = closes[i - 1];
    const current = closes[i];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const diff = current - previous;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiOf({ avgGain, avgLoss });
  }
  return out;
}

function rsiOf({
  avgGain,
  avgLoss,
}: {
  readonly avgGain: number;
  readonly avgLoss: number;
}): number {
  if (avgLoss === 0) {
    return 100;
  }
  if (avgGain === 0) {
    return 0;
  }
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

