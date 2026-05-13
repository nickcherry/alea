import {
  bodyDirection,
  bodyFraction,
  bodySize,
  meanVolume,
} from "@alea/lib/filters/_barMath";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAtrSeries } from "@alea/lib/indicators/atr";
import { z } from "zod";

/**
 * Late-stage volume climax fade. The hypothesis is "everyone finally
 * piles in late": after an extended directional move, a large
 * body candle prints on huge relative volume — that's where
 * exhaustion typically lands. Only fires when the move is already
 * extended (`minPriorMoveAtr` ATRs covered in the prior
 * `priorLookback` bars in the climax direction), so it does NOT
 * fade every high-volume green/red bar.
 *
 * Signal:
 *  - Prior up-move + large green body + volume climax → DOWN
 *  - Prior down-move + large red body + volume climax → UP
 *
 * Knobs:
 *  - `volLength`: SMA window for relative-volume baseline.
 *  - `relVolMin`: latest bar must exceed this multiple of avg volume.
 *  - `atrLength`: ATR window (used for prior-move and body-size
 *    normalization).
 *  - `priorLookback`: window of bars (exclusive of latest) measured
 *    for the prior move.
 *  - `minPriorMoveAtr`: prior close-to-close move must clear this
 *    many ATRs in the same direction as the climax candle.
 *  - `minBodyAtr`: latest bar's body must be at least this many ATRs.
 *  - `minBodyFraction`: latest bar's body/range ratio must clear this.
 */
const configSchema = z.object({
  volLength: z.number().int().positive().default(20),
  relVolMin: z.number().positive().default(2.5),
  atrLength: z.number().int().positive().default(14),
  priorLookback: z.number().int().positive().default(5),
  minPriorMoveAtr: z.number().nonnegative().default(1.5),
  minBodyAtr: z.number().nonnegative().default(0.7),
  minBodyFraction: z.number().min(0).max(1).default(0.6),
});
type Config = z.infer<typeof configSchema>;

export const lateVolumeClimaxFade: Filter<Config> = {
  id: "late_volume_climax_fade",
  version: 1,
  barSource: "coinbase",
  family: "volume_exhaustion",
  description:
    "Late-stage volume climax fade. Requires an extended prior move in the climax direction before fading a big-body, high-relative-volume bar. Up-move + green climax → DOWN; down-move + red climax → UP.",
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
    const body = bodyFraction(latest);
    if (body === null || body < config.minBodyFraction) {
      return null;
    }
    if (bodySize(latest) < config.minBodyAtr * atr) {
      return null;
    }
    const direction = bodyDirection(latest);
    if (direction === null) {
      return null;
    }
    const priorStart = n - 1 - config.priorLookback;
    const priorStartBar = bars[priorStart];
    if (priorStartBar === undefined) {
      return null;
    }
    // close-to-close run measured from the start of the prior window
    // to the close BEFORE the latest bar — i.e. the move into the
    // climax candle, not including it.
    const priorEndBar = bars[n - 2];
    if (priorEndBar === undefined) {
      return null;
    }
    const priorMove = priorEndBar.close - priorStartBar.close;
    const minPriorMove = config.minPriorMoveAtr * atr;
    if (direction === "up") {
      if (priorMove < minPriorMove) {
        return null;
      }
      return "down";
    }
    if (-priorMove < minPriorMove) {
      return null;
    }
    return "up";
  },
};

registerFilter({
  filter: lateVolumeClimaxFade as Filter<unknown>,
  defaultConfigs: () => [
    {
      volLength: 20,
      relVolMin: 2.5,
      atrLength: 14,
      priorLookback: 5,
      minPriorMoveAtr: 1.5,
      minBodyAtr: 0.7,
      minBodyFraction: 0.6,
    },
    {
      volLength: 20,
      relVolMin: 3.0,
      atrLength: 14,
      priorLookback: 8,
      minPriorMoveAtr: 2.0,
      minBodyAtr: 0.8,
      minBodyFraction: 0.55,
    },
    {
      volLength: 50,
      relVolMin: 2.5,
      atrLength: 14,
      priorLookback: 10,
      minPriorMoveAtr: 2.5,
      minBodyAtr: 0.8,
      minBodyFraction: 0.6,
    },
    {
      volLength: 20,
      relVolMin: 4.0,
      atrLength: 7,
      priorLookback: 5,
      minPriorMoveAtr: 1.2,
      minBodyAtr: 0.6,
      minBodyFraction: 0.65,
    },
    {
      volLength: 50,
      relVolMin: 3.0,
      atrLength: 20,
      priorLookback: 12,
      minPriorMoveAtr: 3.0,
      minBodyAtr: 1.0,
      minBodyFraction: 0.5,
    },
  ],
});
