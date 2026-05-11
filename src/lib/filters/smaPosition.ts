import {
  defaultMovingAveragePositionConfigs,
  makeMovingAveragePredict,
  type MovingAveragePositionConfig,
  movingAveragePositionConfigSchema,
} from "@alea/lib/filters/_movingAveragePosition";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeSmaSeries } from "@alea/lib/indicators/sma";

/**
 * Position-vs-SMA filter. "Where is price relative to the simple
 * moving average, and does the next bar tend to continue (trend
 * mode) or revert (revert mode)?"
 *
 * Earlier we tested SMA *crosses* (a faster SMA crossing a slower
 * SMA) and the entire family came in under 50% aggregate. This
 * filter tests the simpler reading: just price vs. one SMA, with an
 * optional stretch-threshold gate so the reversion variant only
 * fires when price is meaningfully stretched.
 */
export const smaPosition: Filter<MovingAveragePositionConfig> = {
  id: "sma_position",
  version: 1,
  regime: "ma_position",
  description:
    "Fires on the close's position relative to an N-bar SMA. `mode=trend` predicts UP when above and DOWN when below (the 'price tends to continue with the SMA bias' hypothesis); `mode=revert` predicts the inverse (mean-reversion to the SMA). `threshold` gates the firing to only fire when the close is at least that fraction of the SMA away — useful for testing the 'reversion only happens at extremes' variant.",
  configSchema: movingAveragePositionConfigSchema,
  requiredBars: (c) => c.length + 1,
  predict: makeMovingAveragePredict({
    computeMa: (bars, config) =>
      computeSmaSeries({
        closes: bars.map((b) => b.close),
        period: config.length,
      }),
  }),
};

registerFilter({
  filter: smaPosition as Filter<unknown>,
  defaultConfigs: () => [...defaultMovingAveragePositionConfigs],
});
