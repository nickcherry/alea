import { computeWilderRsiSeries } from "@alea/lib/training/indicators/computeWilderRsiSeries";
import type {
  BarDivergenceFlags,
  RsiDivergenceConfig,
  RsiDivergenceLabel,
} from "@alea/lib/training/regimeAlgos/rsiDivergence/types";
import { NO_DIVERGENCE_FLAGS } from "@alea/lib/training/regimeAlgos/rsiDivergence/types";

/**
 * One closed bar's worth of OHLC. We only need high/low/close; volume
 * doesn't enter the divergence math. A trimmed `Candle` would work
 * too, but threading the full type would couple this module to the
 * shape we use in the candles loader. Keeping it small.
 */
export type DivergenceBar = {
  readonly openTimeMs: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
};

export type DivergenceComputation = {
  /** Per-bar fired-divergence flags. Same length as the input. */
  readonly flagsByIndex: readonly BarDivergenceFlags[];
  /** Per-bar Wilder-RSI value. Same length, null until warmup. */
  readonly rsiByIndex: readonly (number | null)[];
};

/**
 * Pure port of the standard "Bullish/Bearish + Hidden" RSI divergence
 * detection (the Pine Script template most TradingView users start
 * from). Walks the closed-bar series once, computes Wilder RSI,
 * scans for pivot-low/high pairs in the RSI series, and at the bar
 * a pivot completes (i.e., `lbR` bars after the actual pivot) checks
 * the four divergence conditions against the prior pivot of the same
 * kind:
 *
 *   regular bullish  : price LL  + RSI HL  → reversal-up
 *   hidden  bullish  : price HL  + RSI LL  → uptrend-continuation
 *   regular bearish  : price HH  + RSI LH  → reversal-down
 *   hidden  bearish  : price LH  + RSI HH  → downtrend-continuation
 *
 * The `(rangeLower, rangeUpper)` window restricts how far apart two
 * consecutive pivots can be (in bars) before the second one is
 * counted as a divergence completion. Outside that window the bar
 * just gets `NO_DIVERGENCE_FLAGS`.
 *
 * No "active state" / lookback logic here — that belongs to
 * `labelAt` so callers can tune the lookback without recomputing the
 * whole series.
 */
export function computeDivergenceSeries({
  bars,
  config,
}: {
  readonly bars: readonly DivergenceBar[];
  readonly config: RsiDivergenceConfig;
}): DivergenceComputation {
  if (bars.length === 0) {
    return { flagsByIndex: [], rsiByIndex: [] };
  }
  const closes = bars.map((b) => b.close);
  const rsiByIndex = computeWilderRsiSeries({
    closes,
    period: config.rsiLength,
  });
  const flagsByIndex = detectDivergencesGivenRsi({
    bars,
    rsiByIndex,
    config,
  });
  return { flagsByIndex, rsiByIndex };
}

/**
 * Lower-level helper: given the bar series AND a precomputed RSI
 * series of equal length, scan for pivots and emit the per-bar
 * divergence flags. Same algorithm as `computeDivergenceSeries`, but
 * lets tests inject hand-crafted RSI patterns without going through
 * the gain/loss math (which is degenerate on flat or extreme price
 * series).
 */
export function detectDivergencesGivenRsi({
  bars,
  rsiByIndex,
  config,
}: {
  readonly bars: readonly DivergenceBar[];
  readonly rsiByIndex: readonly (number | null)[];
  readonly config: RsiDivergenceConfig;
}): readonly BarDivergenceFlags[] {
  const { rsiLength, lbL, lbR, rangeLower, rangeUpper } = config;
  const flagsByIndex: BarDivergenceFlags[] = new Array(bars.length).fill(
    NO_DIVERGENCE_FLAGS,
  );
  if (bars.length === 0 || bars.length !== rsiByIndex.length) {
    return flagsByIndex;
  }

  // Indices (in `bars`) of the most recently FOUND RSI-pivot lows /
  // highs. We track ALL of them so we can detect the previous pivot
  // of the same kind when a new one completes — `valuewhen(plFound,
  // expr, 1)` in Pine Script. With lbL+lbR around 10 bars and 730d of
  // 5m data (~210k bars), this stays small (a few hundred entries).
  const pivotLowIndices: number[] = [];
  const pivotHighIndices: number[] = [];

  // Pine Script's `pivotlow(osc, lbL, lbR)` becomes non-na at bar `t`
  // when `osc[t - lbR]` is strictly less than `osc[t - lbR - lbL .. t]
  // \ {t - lbR}` — equivalently: a strict local min with `lbL` higher
  // values to the left and `lbR` higher values to the right.
  const startCheckIdx = Math.max(rsiLength, lbL + lbR);
  for (let t = startCheckIdx; t < bars.length; t += 1) {
    const pivotIdx = t - lbR;
    if (pivotIdx < 0) {
      continue;
    }
    const pivotRsi = rsiByIndex[pivotIdx];
    if (pivotRsi === null || pivotRsi === undefined) {
      continue;
    }

    const isLow = isStrictPivotLow({ rsi: rsiByIndex, idx: pivotIdx, lbL, lbR });
    const isHigh = isStrictPivotHigh({
      rsi: rsiByIndex,
      idx: pivotIdx,
      lbL,
      lbR,
    });

    if (isLow) {
      const flags = checkBullDivergences({
        bars,
        rsi: rsiByIndex,
        pivotIdx,
        prevIdx: pivotLowIndices[pivotLowIndices.length - 1],
        rangeLower,
        rangeUpper,
      });
      if (flags !== null) {
        flagsByIndex[t] = mergeFlags(flagsByIndex[t]!, flags);
      }
      pivotLowIndices.push(pivotIdx);
    }

    if (isHigh) {
      const flags = checkBearDivergences({
        bars,
        rsi: rsiByIndex,
        pivotIdx,
        prevIdx: pivotHighIndices[pivotHighIndices.length - 1],
        rangeLower,
        rangeUpper,
      });
      if (flags !== null) {
        flagsByIndex[t] = mergeFlags(flagsByIndex[t]!, flags);
      }
      pivotHighIndices.push(pivotIdx);
    }
  }

  return flagsByIndex;
}

/**
 * Lookback rule. Walks the flag array from `atIdx` backwards over
 * the most recent `lookbackBars` bars (inclusive of `atIdx`); returns
 * the most recent active divergence label, or `"no_div"` if none.
 *
 * Tiebreaker on the same bar: regular > hidden. Bull and bear can't
 * naturally co-occur on a single completion bar (one resolves a
 * pivot-low, the other a pivot-high — different pivots), but
 * synthetic series can be constructed where both fire simultaneously;
 * in that case we still prefer regular over hidden, then bull over
 * bear (alphabetical, no signal-driven reason to prefer either side).
 */
export function labelAt({
  flagsByIndex,
  atIdx,
  lookbackBars,
}: {
  readonly flagsByIndex: readonly BarDivergenceFlags[];
  readonly atIdx: number;
  readonly lookbackBars: number;
}): RsiDivergenceLabel {
  if (atIdx < 0 || atIdx >= flagsByIndex.length) {
    return "no_div";
  }
  const start = Math.max(0, atIdx - lookbackBars + 1);
  for (let i = atIdx; i >= start; i -= 1) {
    const f = flagsByIndex[i]!;
    if (!f.flagged) {
      continue;
    }
    if (f.regBull) {
      return "bull_div";
    }
    if (f.regBear) {
      return "bear_div";
    }
    if (f.hidBull) {
      return "hidden_bull_div";
    }
    if (f.hidBear) {
      return "hidden_bear_div";
    }
  }
  return "no_div";
}

function isStrictPivotLow({
  rsi,
  idx,
  lbL,
  lbR,
}: {
  readonly rsi: readonly (number | null)[];
  readonly idx: number;
  readonly lbL: number;
  readonly lbR: number;
}): boolean {
  const center = rsi[idx];
  if (center === null || center === undefined) {
    return false;
  }
  for (let i = idx - lbL; i <= idx + lbR; i += 1) {
    if (i === idx) {
      continue;
    }
    const v = rsi[i];
    if (v === null || v === undefined) {
      return false;
    }
    if (v <= center) {
      return false;
    }
  }
  return true;
}

function isStrictPivotHigh({
  rsi,
  idx,
  lbL,
  lbR,
}: {
  readonly rsi: readonly (number | null)[];
  readonly idx: number;
  readonly lbL: number;
  readonly lbR: number;
}): boolean {
  const center = rsi[idx];
  if (center === null || center === undefined) {
    return false;
  }
  for (let i = idx - lbL; i <= idx + lbR; i += 1) {
    if (i === idx) {
      continue;
    }
    const v = rsi[i];
    if (v === null || v === undefined) {
      return false;
    }
    if (v >= center) {
      return false;
    }
  }
  return true;
}

function checkBullDivergences({
  bars,
  rsi,
  pivotIdx,
  prevIdx,
  rangeLower,
  rangeUpper,
}: {
  readonly bars: readonly DivergenceBar[];
  readonly rsi: readonly (number | null)[];
  readonly pivotIdx: number;
  readonly prevIdx: number | undefined;
  readonly rangeLower: number;
  readonly rangeUpper: number;
}): { regBull: boolean; hidBull: boolean } | null {
  if (prevIdx === undefined) {
    return null;
  }
  const gap = pivotIdx - prevIdx;
  if (gap < rangeLower || gap > rangeUpper) {
    return null;
  }
  const prevRsi = rsi[prevIdx];
  const currRsi = rsi[pivotIdx];
  const prevBar = bars[prevIdx];
  const currBar = bars[pivotIdx];
  if (
    prevRsi === null ||
    prevRsi === undefined ||
    currRsi === null ||
    currRsi === undefined ||
    prevBar === undefined ||
    currBar === undefined
  ) {
    return null;
  }
  // Regular bull: price LL + RSI HL.
  const priceLL = currBar.low < prevBar.low;
  const oscHL = currRsi > prevRsi;
  const regBull = priceLL && oscHL;
  // Hidden bull: price HL + RSI LL.
  const priceHL = currBar.low > prevBar.low;
  const oscLL = currRsi < prevRsi;
  const hidBull = priceHL && oscLL;
  if (!regBull && !hidBull) {
    return null;
  }
  return { regBull, hidBull };
}

function checkBearDivergences({
  bars,
  rsi,
  pivotIdx,
  prevIdx,
  rangeLower,
  rangeUpper,
}: {
  readonly bars: readonly DivergenceBar[];
  readonly rsi: readonly (number | null)[];
  readonly pivotIdx: number;
  readonly prevIdx: number | undefined;
  readonly rangeLower: number;
  readonly rangeUpper: number;
}): { regBear: boolean; hidBear: boolean } | null {
  if (prevIdx === undefined) {
    return null;
  }
  const gap = pivotIdx - prevIdx;
  if (gap < rangeLower || gap > rangeUpper) {
    return null;
  }
  const prevRsi = rsi[prevIdx];
  const currRsi = rsi[pivotIdx];
  const prevBar = bars[prevIdx];
  const currBar = bars[pivotIdx];
  if (
    prevRsi === null ||
    prevRsi === undefined ||
    currRsi === null ||
    currRsi === undefined ||
    prevBar === undefined ||
    currBar === undefined
  ) {
    return null;
  }
  // Regular bear: price HH + RSI LH.
  const priceHH = currBar.high > prevBar.high;
  const oscLH = currRsi < prevRsi;
  const regBear = priceHH && oscLH;
  // Hidden bear: price LH + RSI HH.
  const priceLH = currBar.high < prevBar.high;
  const oscHH = currRsi > prevRsi;
  const hidBear = priceLH && oscHH;
  if (!regBear && !hidBear) {
    return null;
  }
  return { regBear, hidBear };
}

function mergeFlags(
  base: BarDivergenceFlags,
  add: {
    readonly regBull?: boolean;
    readonly hidBull?: boolean;
    readonly regBear?: boolean;
    readonly hidBear?: boolean;
  },
): BarDivergenceFlags {
  const regBull = base.regBull || add.regBull === true;
  const hidBull = base.hidBull || add.hidBull === true;
  const regBear = base.regBear || add.regBear === true;
  const hidBear = base.hidBear || add.hidBear === true;
  return {
    regBull,
    hidBull,
    regBear,
    hidBear,
    flagged: regBull || hidBull || regBear || hidBear,
  };
}
