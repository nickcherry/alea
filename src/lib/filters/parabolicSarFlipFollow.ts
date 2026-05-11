import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeParabolicSarSeries } from "@alea/lib/indicators/parabolicSar";
import { z } from "zod";

const configSchema = z.object({
  step: z.number().positive().default(0.02),
  maxStep: z.number().positive().default(0.2),
});
type Config = z.infer<typeof configSchema>;

export const parabolicSarFlipFollow: Filter<Config> = {
  id: "parabolic_sar_flip_follow",
  version: 1,
  family: "trend_flip_continuation",
  description:
    "Parabolic SAR flip follow. A latest-bar flip from SAR above price to below price predicts UP; the reverse flip predicts DOWN.",
  configSchema,
  requiredBars: () => 50,
  predict: (config, bars) => {
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const { trend } = computeParabolicSarSeries({
      highs,
      lows,
      closes,
      step: config.step,
      maxStep: config.maxStep,
    });
    const latest = trend[trend.length - 1];
    const previous = trend[trend.length - 2];
    if (
      latest === null ||
      latest === undefined ||
      previous === null ||
      previous === undefined ||
      latest === previous
    ) {
      return null;
    }
    return latest;
  },
};

registerFilter({
  filter: parabolicSarFlipFollow as Filter<unknown>,
  defaultConfigs: () => [
    { step: 0.02, maxStep: 0.2 },
    { step: 0.01, maxStep: 0.1 },
    { step: 0.02, maxStep: 0.1 },
    { step: 0.03, maxStep: 0.2 },
    { step: 0.01, maxStep: 0.2 },
  ],
});

