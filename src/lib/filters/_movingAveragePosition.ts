import type {
  Filter,
  FilterBar,
  FilterPrediction,
} from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * Shared schema + predict body for "where is price relative to a
 * moving average, and which direction does that lean us?". The three
 * concrete filter files (`smaPosition`, `emaPosition`, `vwmaPosition`)
 * differ only in which MA they compute; the rest of the decision
 * tree — threshold gate, trend-vs-revert mode, direction mapping —
 * is identical and lives here.
 *
 * No-leak invariant: the MA is computed over the closed bars in the
 * window. The prediction target is bar+1, which is never in the
 * window. `bars[bars.length - 1]` is the just-closed bar and that's
 * the latest price we read.
 */

export const movingAveragePositionConfigSchema = z.object({
  /** Window length for the underlying MA. */
  length: z.number().int().positive().default(20),
  /**
   * `"trend"` — predict in the direction we're already stretched
   * (above MA → UP, below → DOWN). The "momentum is more likely to
   * continue than reverse" hypothesis.
   *
   * `"revert"` — predict against the stretch (above MA → DOWN, below
   * MA → UP). The "price is mean-reverting toward the MA" hypothesis.
   */
  mode: z.enum(["trend", "revert"]).default("revert"),
  /**
   * Minimum absolute deviation from the MA (as a fraction of the MA
   * value) for the filter to engage. `0` means "engage on any side";
   * higher values gate the filter to only engage when price is
   * meaningfully stretched, useful for the reversion hypothesis.
   * E.g. `0.005` = "only engage when price is at least 0.5% from the
   * MA".
   */
  threshold: z.number().min(0).default(0),
});

export type MovingAveragePositionConfig = z.infer<
  typeof movingAveragePositionConfigSchema
>;

/**
 * Predict body used by every position filter. `computeMa` is the
 * indicator hook — the only thing that differs between SMA / EMA /
 * VWMA at this layer.
 */
export function makeMovingAveragePredict({
  computeMa,
}: {
  readonly computeMa: (
    bars: readonly FilterBar[],
    config: MovingAveragePositionConfig,
  ) => (number | null)[];
}): Filter<MovingAveragePositionConfig>["predict"] {
  return (config, bars) => {
    const series = computeMa(bars, config);
    const ma = series[series.length - 1];
    const close = bars[bars.length - 1]?.close;
    if (ma === null || ma === undefined || close === undefined || ma === 0) {
      return null;
    }
    const deviation = (close - ma) / ma;
    if (Math.abs(deviation) < config.threshold) {
      return null;
    }
    const above = deviation > 0;
    return resolveDirection({ above, mode: config.mode });
  };
}

function resolveDirection({
  above,
  mode,
}: {
  readonly above: boolean;
  readonly mode: MovingAveragePositionConfig["mode"];
}): FilterPrediction {
  // Trend: go with the stretch. Revert: fade it.
  if (mode === "trend") {
    return above ? "up" : "down";
  }
  return above ? "down" : "up";
}

/**
 * Seed configs shared across the position filters. Only revert
 * configs survived the >50% prune — the trend variants at every
 * length came in at 47-49% WR (anti-edge, predictably the inverse
 * of the revert side). Thresholds run from 0 (always engage) up to
 * 0.02 (deep-stretch only) so the per-length decay curve stays
 * visible across the surviving grid.
 */
export const defaultMovingAveragePositionConfigs: ReadonlyArray<MovingAveragePositionConfig> =
  [
    { length: 14, mode: "revert", threshold: 0.005 },
    { length: 14, mode: "revert", threshold: 0.01 },
    { length: 20, mode: "revert", threshold: 0.005 },
    { length: 20, mode: "revert", threshold: 0.01 },
    { length: 20, mode: "revert", threshold: 0.02 },
    { length: 10, mode: "revert", threshold: 0.015 },
    { length: 14, mode: "revert", threshold: 0.02 },
    { length: 10, mode: "revert", threshold: 0.02 },
    { length: 30, mode: "revert", threshold: 0.01 },
  ];
