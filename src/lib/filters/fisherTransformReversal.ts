import { highestHigh, lowestLow } from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter, FilterBar } from "@alea/lib/filters/types";
import { z } from "zod";

const configSchema = z.object({
  length: z.number().int().positive().default(10),
  upper: z.number().positive().default(1.5),
  lower: z.number().negative().default(-1.5),
  trigger: z.enum(["turn", "signalCross"]).default("turn"),
});
type Config = z.infer<typeof configSchema>;

export const fisherTransformReversal: Filter<Config> = {
  id: "fisher_transform_reversal",
  version: 1,
  family: "oscillator_reversal",
  description:
    "Fades Fisher Transform extremes. A high Fisher turn or signal cross predicts DOWN; a low extreme turn or cross predicts UP.",
  configSchema,
  requiredBars: (c) => c.length + 10,
  predict: (config, bars) => {
    const fisher = computeFisher({ bars, length: config.length });
    const n = fisher.length;
    const current = fisher[n - 1];
    const previous = fisher[n - 2];
    const twoBack = fisher[n - 3];
    if (
      current === null ||
      current === undefined ||
      previous === null ||
      previous === undefined
    ) {
      return null;
    }
    if (config.trigger === "turn") {
      if (previous >= config.upper && current < previous) {
        return "down";
      }
      if (previous <= config.lower && current > previous) {
        return "up";
      }
      return null;
    }
    if (twoBack === null || twoBack === undefined) {
      return null;
    }
    if (previous >= config.upper && twoBack >= previous && current < previous) {
      return "down";
    }
    if (previous <= config.lower && twoBack <= previous && current > previous) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: fisherTransformReversal as Filter<unknown>,
  defaultConfigs: () => [
    { length: 10, upper: 1.5, lower: -1.5, trigger: "turn" },
    { length: 10, upper: 2, lower: -2, trigger: "turn" },
    { length: 14, upper: 1.5, lower: -1.5, trigger: "signalCross" },
    { length: 20, upper: 1.25, lower: -1.25, trigger: "turn" },
    { length: 7, upper: 2, lower: -2, trigger: "signalCross" },
  ],
});

function computeFisher({
  bars,
  length,
}: {
  readonly bars: readonly FilterBar[];
  readonly length: number;
}): readonly (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(bars.length).fill(
    null,
  );
  let value = 0;
  let fisher = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    if (bar === undefined || i < length - 1) {
      continue;
    }
    const high = highestHigh({
      bars,
      start: i - length + 1,
      endExclusive: i + 1,
    });
    const low = lowestLow({ bars, start: i - length + 1, endExclusive: i + 1 });
    if (high === null || low === null || high <= low) {
      continue;
    }
    const median = (bar.high + bar.low) / 2;
    const normalized = 2 * ((median - low) / (high - low) - 0.5);
    value = clamp(0.33 * normalized + 0.67 * value, -0.999, 0.999);
    fisher = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * fisher;
    out[i] = fisher;
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
