import { bodyDirection, bodySize } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

const ATR_LENGTH = 14;

const configSchema = z.object({
  lookback: z.number().int().min(3).default(20),
  mode: z.enum(["signedBody", "signOnly"]).default("signedBody"),
  minAbsCorr: z.number().min(0).max(1).default(0.25),
  minLastBodyAtr: z.number().nonnegative().default(0),
});
type Config = z.infer<typeof configSchema>;

export const localBodyAutocorrDirection: Filter<Config> = {
  id: "local_body_autocorr_direction",
  version: 1,
  family: "body_sign_regime",
  description:
    "Uses recent lag-1 candle-body autocorrelation. Positive autocorrelation follows the latest body sign; negative autocorrelation predicts alternation.",
  configSchema,
  requiredBars: (c) => Math.max(c.lookback, ATR_LENGTH + 2),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    if (latest === undefined) {
      return null;
    }
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const atr = computeAtrSeries({
      highs,
      lows,
      closes,
      period: ATR_LENGTH,
    })[n - 2];
    if (
      atr === null ||
      atr === undefined ||
      atr <= 0 ||
      bodySize(latest) / atr < config.minLastBodyAtr
    ) {
      return null;
    }
    const latestDirection = bodyDirection(latest);
    if (latestDirection === null) {
      return null;
    }
    const values: number[] = [];
    for (let i = n - config.lookback; i < n; i += 1) {
      const bar = bars[i];
      if (bar === undefined) {
        return null;
      }
      const signedBody = bar.close - bar.open;
      values.push(
        config.mode === "signedBody" ? signedBody : Math.sign(signedBody),
      );
    }
    const corr = lagOneCorrelation(values);
    if (corr === null || Math.abs(corr) < config.minAbsCorr) {
      return null;
    }
    if (corr > 0) {
      return latestDirection;
    }
    return latestDirection === "up" ? "down" : "up";
  },
};

registerFilter({
  filter: localBodyAutocorrDirection as Filter<unknown>,
  defaultConfigs: () => [
    { lookback: 20, mode: "signedBody", minAbsCorr: 0.25, minLastBodyAtr: 0 },
    { lookback: 30, mode: "signedBody", minAbsCorr: 0.2, minLastBodyAtr: 0.01 },
    { lookback: 50, mode: "signedBody", minAbsCorr: 0.15, minLastBodyAtr: 0 },
    { lookback: 20, mode: "signOnly", minAbsCorr: 0.35, minLastBodyAtr: 0 },
    { lookback: 40, mode: "signOnly", minAbsCorr: 0.25, minLastBodyAtr: 0.01 },
  ],
});

function lagOneCorrelation(values: readonly number[]): number | null {
  if (values.length < 3) {
    return null;
  }
  const x = values.slice(0, -1);
  const y = values.slice(1);
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < x.length; i += 1) {
    const xValue = x[i];
    const yValue = y[i];
    if (xValue === undefined || yValue === undefined) {
      return null;
    }
    const dx = xValue - meanX;
    const dy = yValue - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX <= 0 || varianceY <= 0) {
    return null;
  }
  return covariance / Math.sqrt(varianceX * varianceY);
}
