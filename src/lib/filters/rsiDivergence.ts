import { computeWilderRsiSeries } from "@alea/lib/indicators/rsi";
import { registerFilter } from "@alea/lib/filters/registry";
import type { Filter, FilterBar } from "@alea/lib/filters/types";
import { z } from "zod";

/**
 * RSI divergence detector, modeled on the TradingView "RSI Divergence
 * Indicator" (Pine Script v6 — the canonical community version).
 * Predicts UP when a bullish RSI/price divergence prints at a pivot
 * low, DOWN when a bearish one prints at a pivot high. Hidden
 * divergences (continuation patterns) are gated behind an opt-in
 * flag, off by default to match the TV indicator's defaults.
 *
 * The pivot definition matches `ta.pivothigh(osc, lbL, lbR)` /
 * `ta.pivotlow`: bar `p` is a pivot iff the RSI at `p` is strictly
 * more extreme than the RSI at every bar in `[p - lbL, p + lbR]`
 * besides `p` itself. A pivot is confirmed `lbR` bars after the
 * fact, so the in-flight bar can never be the pivot; the most
 * recent candidate is `bars[-1 - lbR]` looking back into the window.
 *
 * Divergence pattern, on the just-confirmed pivot:
 *
 *   pivot LOW
 *     bullish (regular):       RSI higher-low, price lower-low   → UP
 *     bullish (hidden, opt-in): RSI lower-low,  price higher-low  → UP
 *
 *   pivot HIGH
 *     bearish (regular):       RSI lower-high,  price higher-high → DOWN
 *     bearish (hidden, opt-in): RSI higher-high, price lower-high  → DOWN
 *
 * "Higher-low" etc. are the RSI / price reading at the current
 * pivot vs. the IMMEDIATELY PRECEDING pivot of the same kind. The
 * prior pivot must sit between `rangeLower` and `rangeUpper` bars
 * back from the current pivot (mirrors `_inRange(plFound[1])` in
 * the Pine source); otherwise we abstain on the assumption the two
 * pivots are too close (noise) or too far (regime shift) to call a
 * divergence.
 *
 * No-leak invariant: every position we read is at or before the
 * just-closed bar `bars[bars.length - 1]`. The "prediction subject"
 * is bar+1, which is never in the window.
 */
const configSchema = z.object({
  /** RSI period — passed straight to `computeWilderRsiSeries`. */
  period: z.number().int().positive().default(14),
  /**
   * Left-hand pivot lookback. RSI at the candidate pivot must be
   * strictly more extreme than RSI at each of the preceding `lbL`
   * bars. Matches `ta.pivot*(osc, lbL, lbR)`'s left arg.
   */
  lbL: z.number().int().positive().default(5),
  /**
   * Right-hand pivot lookback / confirmation lag. Same role on the
   * right as `lbL` on the left. The pivot is confirmed `lbR` bars
   * after the actual extremum.
   */
  lbR: z.number().int().positive().default(5),
  /**
   * Minimum bars between this pivot and the prior one. Sub-`rangeLower`
   * gaps usually mean RSI noise on near-flat price, not a real
   * divergence pair.
   */
  rangeLower: z.number().int().positive().default(5),
  /**
   * Maximum bars between this pivot and the prior one. If the prior
   * pivot is `rangeUpper`-plus bars back, the market has likely
   * regime-shifted between the two and the comparison isn't meaningful.
   */
  rangeUpper: z.number().int().positive().default(60),
  /**
   * Off by default — hidden divergences are "continuation" rather
   * than "reversal" signals and have historically been weaker than
   * the regular pattern. Flip on to count them too.
   */
  includeHidden: z.boolean().default(false),
});
type Config = z.infer<typeof configSchema>;

export const rsiDivergence: Filter<Config> = {
  id: "rsi_divergence",
  version: 1,
  regime: "divergence",
  description:
    "RSI/price divergence. Fires UP on a confirmed pivot low when RSI made a higher-low against a price lower-low (regular bullish divergence — classic reversal pattern); fires DOWN on the symmetric pivot-high case. Hidden continuation divergences are off by default. Pivot definition + bar-gap range match TradingView's Pine `ta.pivothigh / ta.pivotlow` builtins so the signal is identical to the indicator a chart trader would see.",
  configSchema,
  requiredBars: (c) =>
    // We need RSI valid at the earliest pivot we might inspect:
    //   pivotIdx = N - 1 - lbR  (current pivot position)
    //   priorMinIdx = pivotIdx - rangeUpper - lbL  (left edge of the
    //     prior pivot's pivot-check window when the prior pivot sits
    //     at the maximum allowed distance).
    // RSI is null for the first `period` indices, so we need
    //   priorMinIdx >= period
    //   ⇒ N >= period + lbL + rangeUpper + lbR + 1
    // +1 for fence-post safety.
    c.period + c.lbL + c.rangeUpper + c.lbR + 1,
  predict: (config, bars) => {
    const n = bars.length;
    const pivotIdx = n - 1 - config.lbR;
    if (pivotIdx < config.lbL) {
      return null;
    }
    const closes = bars.map((b) => b.close);
    const rsi = computeWilderRsiSeries({ closes, period: config.period });
    const rsiAtPivot = rsi[pivotIdx];
    if (rsiAtPivot === null || rsiAtPivot === undefined) {
      return null;
    }

    const isLow = isPivot({ rsi, idx: pivotIdx, lbL: config.lbL, lbR: config.lbR, kind: "low" });
    const isHigh = isPivot({ rsi, idx: pivotIdx, lbL: config.lbL, lbR: config.lbR, kind: "high" });
    if (!isLow && !isHigh) {
      return null;
    }

    const priorIdx = findPriorPivot({
      rsi,
      from: pivotIdx - 1,
      kind: isLow ? "low" : "high",
      lbL: config.lbL,
      lbR: config.lbR,
    });
    if (priorIdx === null) {
      return null;
    }
    const gap = pivotIdx - priorIdx;
    if (gap < config.rangeLower || gap > config.rangeUpper) {
      return null;
    }

    const priorRsi = rsi[priorIdx];
    if (priorRsi === null || priorRsi === undefined) {
      return null;
    }

    if (isLow) {
      const currentLow = bars[pivotIdx]!.low;
      const priorLow = bars[priorIdx]!.low;
      // Regular bullish: RSI higher-low, price lower-low.
      if (rsiAtPivot > priorRsi && currentLow < priorLow) {
        return "up";
      }
      // Hidden bullish: RSI lower-low, price higher-low.
      if (
        config.includeHidden &&
        rsiAtPivot < priorRsi &&
        currentLow > priorLow
      ) {
        return "up";
      }
      return null;
    }

    // isHigh
    const currentHigh = bars[pivotIdx]!.high;
    const priorHigh = bars[priorIdx]!.high;
    // Regular bearish: RSI lower-high, price higher-high.
    if (rsiAtPivot < priorRsi && currentHigh > priorHigh) {
      return "down";
    }
    // Hidden bearish: RSI higher-high, price lower-high.
    if (
      config.includeHidden &&
      rsiAtPivot > priorRsi &&
      currentHigh < priorHigh
    ) {
      return "down";
    }
    return null;
  },
};

/**
 * True iff `rsi[idx]` is strictly more extreme than every other RSI
 * value in `[idx - lbL, idx + lbR]`. Ties don't count — we treat a
 * plateau as no pivot, same as Pine's strict-comparison behaviour.
 */
function isPivot({
  rsi,
  idx,
  lbL,
  lbR,
  kind,
}: {
  readonly rsi: readonly (number | null)[];
  readonly idx: number;
  readonly lbL: number;
  readonly lbR: number;
  readonly kind: "low" | "high";
}): boolean {
  const value = rsi[idx];
  if (value === null || value === undefined) {
    return false;
  }
  const left = idx - lbL;
  const right = idx + lbR;
  if (left < 0 || right >= rsi.length) {
    return false;
  }
  for (let k = left; k <= right; k += 1) {
    if (k === idx) {
      continue;
    }
    const v = rsi[k];
    if (v === null || v === undefined) {
      return false;
    }
    if (kind === "low" ? v <= value : v >= value) {
      return false;
    }
  }
  return true;
}

/**
 * Most-recent prior pivot of the same kind, walking backward from
 * `from`. Returns `null` if no qualifying pivot exists; the caller
 * is responsible for the `rangeLower`/`rangeUpper` distance check.
 *
 * Match-up with Pine: this is the position the prior `plFound` /
 * `phFound` true-value sat at, minus `lbR` (Pine's `plFound` becomes
 * true `lbR` bars after the actual pivot — we operate directly on
 * the pivot position).
 */
function findPriorPivot({
  rsi,
  from,
  kind,
  lbL,
  lbR,
}: {
  readonly rsi: readonly (number | null)[];
  readonly from: number;
  readonly kind: "low" | "high";
  readonly lbL: number;
  readonly lbR: number;
}): number | null {
  for (let p = from; p >= lbL; p -= 1) {
    if (isPivot({ rsi, idx: p, lbL, lbR, kind })) {
      return p;
    }
  }
  return null;
}

registerFilter({
  filter: rsiDivergence as Filter<unknown>,
  defaultConfigs: () => [
    {"lbL":3,"lbR":3,"period":14,"rangeLower":3,"rangeUpper":40,"includeHidden":false},
    {"lbL":5,"lbR":5,"period":21,"rangeLower":5,"rangeUpper":60,"includeHidden":false},
    {"lbL":5,"lbR":5,"period":14,"rangeLower":5,"rangeUpper":60,"includeHidden":false},
    {"lbL":7,"lbR":7,"period":14,"rangeLower":7,"rangeUpper":80,"includeHidden":false},
    {"lbL":5,"lbR":5,"period":7,"rangeLower":5,"rangeUpper":60,"includeHidden":false},
  ],
});

// Avoid "unused import" lint when the file is consumed only for its
// side-effect registration in `filters/all`. The type re-export
// gives the symbol a public consumer.
export type RsiDivergenceConfig = Config;
export type RsiDivergenceBar = FilterBar;
