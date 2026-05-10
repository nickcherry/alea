import type { DivergenceBar } from "@alea/lib/training/regimeAlgos/rsiDivergence/computeDivergence";

const FIVE_MIN_MS = 5 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

/**
 * Aggregates an ascending sequence of 5m bars into 15m bars on the
 * natural HH:00 / HH:15 / HH:30 / HH:45 boundaries.
 *
 * Each 15m bar uses:
 *   - `openTimeMs` = first 5m bar's openTimeMs (which is on the
 *     15-min boundary)
 *   - `open`  = first 5m bar's open  (NOTE: `DivergenceBar` doesn't
 *     carry `open` explicitly; we approximate with `close` of the
 *     prior bar via `close` of the current is fine for divergence —
 *     only `high`/`low`/`close` are read by the algorithm)
 *   - `high`  = max across the 3 input bars
 *   - `low`   = min across the 3 input bars
 *   - `close` = last 5m bar's close
 *
 * Bars at the edges that don't form a complete 15m group are
 * dropped — the algorithm only cares about CLOSED 15m bars.
 *
 * Input is assumed sorted ascending by `openTimeMs`. The function
 * verifies bars-per-group is exactly 3 with the expected millisecond
 * gap; if a 5m bar is missing from a group (e.g., a publisher gap),
 * the whole group is skipped rather than emitting a degenerate bar.
 */
export function aggregate5mTo15m({
  bars,
}: {
  readonly bars: readonly DivergenceBar[];
}): DivergenceBar[] {
  const out: DivergenceBar[] = [];
  if (bars.length === 0) {
    return out;
  }
  let i = 0;
  while (i < bars.length) {
    const start = bars[i]!;
    if (start.openTimeMs % FIFTEEN_MIN_MS !== 0) {
      // Not on a 15m boundary; advance until we are.
      i += 1;
      continue;
    }
    const second = bars[i + 1];
    const third = bars[i + 2];
    if (
      second === undefined ||
      third === undefined ||
      second.openTimeMs !== start.openTimeMs + FIVE_MIN_MS ||
      third.openTimeMs !== start.openTimeMs + 2 * FIVE_MIN_MS
    ) {
      // Group incomplete or has a gap — skip and try the next 15m
      // boundary in the input.
      i += 1;
      continue;
    }
    const high = Math.max(start.high, second.high, third.high);
    const low = Math.min(start.low, second.low, third.low);
    out.push({
      openTimeMs: start.openTimeMs,
      high,
      low,
      close: third.close,
    });
    i += 3;
  }
  return out;
}

/**
 * For each 5m bar in `bars5m`, find the openTimeMs of the most
 * recent CLOSED 15m bar at-or-before the 5m bar's CLOSE time.
 * Returns an array the same length as `bars5m`; each entry is the
 * `openTimeMs` of the relevant 15m bar, or `null` if no closed 15m
 * bar exists yet (warmup).
 *
 * Used at training time to map per-15m-bar divergence labels onto
 * each 5m window — the 15m signal updates every 3rd 5m window and
 * the same label carries through the intervening windows.
 */
export function map5mToClosed15mIndex({
  bars5m,
  bars15m,
}: {
  readonly bars5m: readonly DivergenceBar[];
  readonly bars15m: readonly DivergenceBar[];
}): (number | null)[] {
  const out: (number | null)[] = new Array(bars5m.length).fill(null);
  if (bars15m.length === 0) {
    return out;
  }
  // Both arrays are ascending; sweep them together.
  let j = 0;
  for (let i = 0; i < bars5m.length; i += 1) {
    const closeMs = bars5m[i]!.openTimeMs + FIVE_MIN_MS;
    // Advance j while the next 15m bar's CLOSE time is <= the 5m
    // bar's CLOSE time. A 15m bar at openTimeMs T closes at T + 15m.
    while (
      j + 1 < bars15m.length &&
      bars15m[j + 1]!.openTimeMs + FIFTEEN_MIN_MS <= closeMs
    ) {
      j += 1;
    }
    const candidate = bars15m[j]!;
    if (candidate.openTimeMs + FIFTEEN_MIN_MS <= closeMs) {
      out[i] = j;
    }
  }
  return out;
}
