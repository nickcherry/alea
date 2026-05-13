import {
  bodyFraction,
  bodySize,
  meanVolume,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * Effort-vs-result fade (Wyckoff). Huge relative volume but tiny
 * body/progress means a lot of effort produced little price
 * movement — the dominant side is being absorbed. Only fires after
 * a meaningful prior move in one direction, so a tiny-body high-
 * volume bar inside a quiet range doesn't qualify.
 *
 * Signal:
 *  - Prior up-pressure + huge-volume tiny body → DOWN
 *  - Prior down-pressure + huge-volume tiny body → UP
 *
 * Knobs:
 *  - `volLength`, `relVolMin`: relative-volume gate.
 *  - `atrLength`, `priorLookback`, `minPriorMoveAtr`: prior close-to-
 *    close move (in ATRs over `priorLookback` bars) the fade requires.
 *  - `maxBodyAtr`: latest bar body must be ≤ this many ATRs.
 *  - `maxBodyFraction`: body/range ratio must be small.
 */
const configSchema = z.object({
  volLength: z.number().int().positive().default(20),
  relVolMin: z.number().positive().default(2.5),
  atrLength: z.number().int().positive().default(14),
  priorLookback: z.number().int().positive().default(5),
  minPriorMoveAtr: z.number().nonnegative().default(1.0),
  maxBodyAtr: z.number().nonnegative().default(0.2),
  maxBodyFraction: z.number().min(0).max(1).default(0.25),
});
type Config = z.infer<typeof configSchema>;

export const effortVsResultFade: Filter<Config> = {
  id: "effort_vs_result_fade",
  version: 1,
  barSource: "coinbase",
  family: "volume_absorption_reversion",
  description:
    "Wyckoff-style effort-vs-result fade. After a meaningful prior move, a huge-volume bar with tiny body means absorption — fade the prior direction.",
  configSchema,
  requiredBars: (c) =>
    Math.max(c.volLength + 1, c.atrLength + 2, c.priorLookback + 1),
  predict: (config, bars) => {
    const n = bars.length;
    const latest = bars[n - 1];
    if (latest === undefined) {
      return null;
    }
    const avgVolume = meanVolume({
      bars,
      start: n - 1 - config.volLength,
      endExclusive: n - 1,
    });
    if (avgVolume === null || avgVolume <= 0) {
      return null;
    }
    if (latest.volume / avgVolume < config.relVolMin) {
      return null;
    }
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const atr = computeAtrSeries({
      highs,
      lows,
      closes,
      period: config.atrLength,
    })[n - 2];
    if (atr === null || atr === undefined || atr <= 0) {
      return null;
    }
    if (bodySize(latest) > config.maxBodyAtr * atr) {
      return null;
    }
    const bodyFrac = bodyFraction(latest);
    if (bodyFrac !== null && bodyFrac > config.maxBodyFraction) {
      return null;
    }
    const priorStart = n - 1 - config.priorLookback;
    const priorStartBar = bars[priorStart];
    const priorEndBar = bars[n - 2];
    if (priorStartBar === undefined || priorEndBar === undefined) {
      return null;
    }
    const priorMove = priorEndBar.close - priorStartBar.close;
    const minPriorMove = config.minPriorMoveAtr * atr;
    if (priorMove >= minPriorMove) {
      return "down";
    }
    if (-priorMove >= minPriorMove) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: effortVsResultFade as Filter<unknown>,
  defaultConfigs: () => [
    {
      volLength: 20,
      relVolMin: 2.5,
      atrLength: 14,
      priorLookback: 5,
      minPriorMoveAtr: 1.0,
      maxBodyAtr: 0.2,
      maxBodyFraction: 0.25,
    },
    {
      volLength: 20,
      relVolMin: 3.0,
      atrLength: 14,
      priorLookback: 8,
      minPriorMoveAtr: 1.5,
      maxBodyAtr: 0.25,
      maxBodyFraction: 0.3,
    },
    {
      volLength: 50,
      relVolMin: 2.2,
      atrLength: 14,
      priorLookback: 10,
      minPriorMoveAtr: 2.0,
      maxBodyAtr: 0.3,
      maxBodyFraction: 0.25,
    },
    {
      volLength: 20,
      relVolMin: 4.0,
      atrLength: 7,
      priorLookback: 5,
      minPriorMoveAtr: 1.0,
      maxBodyAtr: 0.15,
      maxBodyFraction: 0.2,
    },
    {
      volLength: 50,
      relVolMin: 2.8,
      atrLength: 20,
      priorLookback: 12,
      minPriorMoveAtr: 2.5,
      maxBodyAtr: 0.35,
      maxBodyFraction: 0.3,
    },
    // Push the winning band: mid relVol (2.2-2.8) + tighter body + longer prior.
    {
      volLength: 50,
      relVolMin: 2.5,
      atrLength: 14,
      priorLookback: 10,
      minPriorMoveAtr: 1.8,
      maxBodyAtr: 0.2,
      maxBodyFraction: 0.22,
    },
    {
      volLength: 50,
      relVolMin: 2.3,
      atrLength: 14,
      priorLookback: 15,
      minPriorMoveAtr: 2.2,
      maxBodyAtr: 0.25,
      maxBodyFraction: 0.25,
    },
    {
      volLength: 20,
      relVolMin: 2.7,
      atrLength: 14,
      priorLookback: 6,
      minPriorMoveAtr: 1.2,
      maxBodyAtr: 0.18,
      maxBodyFraction: 0.22,
    },
    {
      volLength: 50,
      relVolMin: 2.0,
      atrLength: 14,
      priorLookback: 12,
      minPriorMoveAtr: 1.8,
      maxBodyAtr: 0.3,
      maxBodyFraction: 0.28,
    },
  ],
});
