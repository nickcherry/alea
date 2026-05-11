import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeMfiSeries } from "@alea/lib/indicators/mfi";
import { z } from "zod";

const configSchema = z.object({
  length: z.number().int().positive().default(14),
  oversold: z.number().min(0).max(100).default(20),
  overbought: z.number().min(0).max(100).default(80),
});
type Config = z.infer<typeof configSchema>;

export const mfiMeanRev: Filter<Config> = {
  id: "mfi_meanrev",
  version: 1,
  family: "volume_oscillator_reversion",
  description:
    "Money Flow Index mean reversion. Oversold MFI predicts UP; overbought MFI predicts DOWN, adding volume-weighted oscillator pressure to the registry.",
  configSchema,
  requiredBars: (c) => c.length + 1,
  predict: (config, bars) => {
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);
    const mfi = computeMfiSeries({
      highs,
      lows,
      closes,
      volumes,
      period: config.length,
    })[bars.length - 1];
    if (mfi === null || mfi === undefined) {
      return null;
    }
    if (mfi <= config.oversold) {
      return "up";
    }
    if (mfi >= config.overbought) {
      return "down";
    }
    return null;
  },
};

registerFilter({
  filter: mfiMeanRev as Filter<unknown>,
  defaultConfigs: () => [
    { length: 14, oversold: 20, overbought: 80 },
    { length: 14, oversold: 15, overbought: 85 },
    { length: 7, oversold: 10, overbought: 90 },
    { length: 21, oversold: 20, overbought: 80 },
    { length: 20, oversold: 10, overbought: 90 },
  ],
});

