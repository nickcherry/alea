import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter } from "@alea/lib/filters/types";
import { computeAroonSeries } from "@alea/lib/indicators/aroon";
import { z } from "zod";

/**
 * Aroon-based reversion. Fires when one Aroon leg is high enough
 * (the recent extreme just printed) AND the other leg is low
 * enough (the opposite extreme is far behind):
 *
 *   AroonUp   ≥ upTrigger   AND  AroonDown ≤ downTrigger   →  fire DOWN
 *   AroonDown ≥ upTrigger   AND  AroonUp   ≤ downTrigger   →  fire UP
 *
 * The trigger thresholds are symmetric by name but applied to the
 * matching leg — `upTrigger` is what the "winning" leg must clear
 * (e.g. 90 — within the last 10% of the window), `downTrigger` is
 * the ceiling for the opposite, losing leg (e.g. 30 — its extreme
 * is at least 70% of the window back).
 *
 * Aroon is a time-domain oscillator — it measures how RECENTLY the
 * period's high/low printed, not the magnitude of moves. A reading
 * of (AroonUp=100, AroonDown=10) means "the highest high is the
 * current bar, the lowest low was deep in the past" → market is
 * pinned near its recent top. Reversion bet: predict DOWN.
 *
 * Distinct from the RSI / Stoch / CCI family which all use price
 * magnitudes. If Aroon-based reversion produces a comparable WR to
 * the magnitude oscillators, the reversion signal lives in
 * extremity-of-recency, not extremity-of-magnitude.
 */
const configSchema = z.object({
  period: z.number().int().positive().default(14),
  /** Floor for the "winning" leg (the one at the recent extreme). */
  upTrigger: z.number().min(0).max(100).default(90),
  /** Ceiling for the "losing" leg (its extreme is well in the past). */
  downTrigger: z.number().min(0).max(100).default(30),
});
type Config = z.infer<typeof configSchema>;

export const aroonReversion: Filter<Config> = {
  id: "aroon_reversion",
  version: 1,
  family: "oscillator_reversion",
  description:
    "Reversion on Aroon Up/Down asymmetry. Fires DOWN when AroonUp clears `upTrigger` (recent new high just printed) AND AroonDown sits below `downTrigger` (no recent low). Symmetric for UP. Tests whether the TIME-domain extreme reading carries the same reversion signal as the magnitude-domain oscillators.",
  configSchema,
  requiredBars: (c) => c.period + 1,
  predict: (config, bars) => {
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const { up, down } = computeAroonSeries({
      highs,
      lows,
      period: config.period,
    });
    const i = up.length - 1;
    const u = up[i];
    const d = down[i];
    if (u === null || u === undefined || d === null || d === undefined) {
      return null;
    }
    if (u >= config.upTrigger && d <= config.downTrigger) {
      return "down";
    }
    if (d >= config.upTrigger && u <= config.downTrigger) {
      return "up";
    }
    return null;
  },
};

registerFilter({
  filter: aroonReversion as Filter<unknown>,
  defaultConfigs: () => [
    { period: 50, upTrigger: 100, downTrigger: 0 },
    { period: 25, upTrigger: 100, downTrigger: 0 },
    { period: 25, upTrigger: 100, downTrigger: 30 },
    { period: 14, upTrigger: 100, downTrigger: 0 },
    { period: 14, upTrigger: 100, downTrigger: 30 },
  ],
});
