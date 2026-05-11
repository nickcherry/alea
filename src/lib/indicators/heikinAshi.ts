/**
 * Heikin-Ashi candles, the classic candle-smoothing transform.
 * Each output bar is a function of the current input bar's OHLC
 * plus the PREVIOUS Heikin-Ashi bar's OH:
 *
 *   HA_close_i = (O_i + H_i + L_i + C_i) / 4
 *   HA_open_i  = (HA_open_{i-1} + HA_close_{i-1}) / 2
 *   HA_high_i  = max(H_i, HA_open_i, HA_close_i)
 *   HA_low_i   = min(L_i, HA_open_i, HA_close_i)
 *
 * Seed: `HA_open_0 = (O_0 + C_0) / 2`. The HA series quickly
 * diverges from the raw OHLC because each HA bar embeds the prior
 * HA state — which is exactly the smoothing effect chartists like
 * it for. Consecutive same-color HA bars indicate "the move is
 * continuing"; the rare HA color flip indicates a real reversal
 * candidate.
 *
 * Returns four parallel arrays, same length as input. All entries
 * are non-null after the seed (index 0).
 */
export function computeHeikinAshiSeries({
  opens,
  highs,
  lows,
  closes,
}: {
  readonly opens: readonly number[];
  readonly highs: readonly number[];
  readonly lows: readonly number[];
  readonly closes: readonly number[];
}): {
  readonly haOpen: readonly number[];
  readonly haHigh: readonly number[];
  readonly haLow: readonly number[];
  readonly haClose: readonly number[];
} {
  const n = closes.length;
  if (opens.length !== n || highs.length !== n || lows.length !== n) {
    throw new Error(
      `heikin-ashi inputs length mismatch (O=${opens.length} H=${highs.length} L=${lows.length} C=${n})`,
    );
  }
  const haOpen = new Array<number>(n);
  const haHigh = new Array<number>(n);
  const haLow = new Array<number>(n);
  const haClose = new Array<number>(n);
  if (n === 0) {
    return { haOpen, haHigh, haLow, haClose };
  }
  const o0 = opens[0]!;
  const h0 = highs[0]!;
  const l0 = lows[0]!;
  const c0 = closes[0]!;
  haClose[0] = (o0 + h0 + l0 + c0) / 4;
  haOpen[0] = (o0 + c0) / 2;
  haHigh[0] = Math.max(h0, haOpen[0]!, haClose[0]!);
  haLow[0] = Math.min(l0, haOpen[0]!, haClose[0]!);
  for (let i = 1; i < n; i += 1) {
    const o = opens[i]!;
    const h = highs[i]!;
    const l = lows[i]!;
    const c = closes[i]!;
    haClose[i] = (o + h + l + c) / 4;
    haOpen[i] = (haOpen[i - 1]! + haClose[i - 1]!) / 2;
    haHigh[i] = Math.max(h, haOpen[i]!, haClose[i]!);
    haLow[i] = Math.min(l, haOpen[i]!, haClose[i]!);
  }
  return { haOpen, haHigh, haLow, haClose };
}
