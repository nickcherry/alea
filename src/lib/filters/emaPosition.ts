import {
  defaultMovingAveragePositionConfigs,
  makeMovingAveragePredict,
  type MovingAveragePositionConfig,
  movingAveragePositionConfigSchema,
} from "@alea/lib/filters/_movingAveragePosition";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeEmaSeries } from "@alea/lib/indicators/ema";

/**
 * Position-vs-EMA filter. Same trend/revert/threshold question as
 * `sma_position` but tracked against an exponential moving average,
 * which weights recent bars more heavily and so reacts to fresh
 * moves faster than the equal-weighted SMA.
 *
 * Hypothesis being tested: EMA's responsiveness either (a) makes
 * the "stretch" reading more accurate because the baseline is more
 * current, or (b) tracks price so closely that meaningful stretches
 * never form. SMA vs. EMA results side-by-side tell us which.
 */
export const emaPosition: Filter<MovingAveragePositionConfig> = {
  id: "ema_position",
  version: 1,
  family: "ma_position",
  description:
    "Fires on the close's position relative to an N-bar EMA. Same decision tree as `sma_position`; only the baseline differs (EMA weights recent bars more heavily).",
  configSchema: movingAveragePositionConfigSchema,
  requiredBars: (c) => c.length + 1,
  predict: makeMovingAveragePredict({
    computeMa: (bars, config) =>
      computeEmaSeries({
        closes: bars.map((b) => b.close),
        period: config.length,
      }),
  }),
};

registerFilter({
  filter: emaPosition as Filter<unknown>,
  defaultConfigs: () => [...defaultMovingAveragePositionConfigs],
});
