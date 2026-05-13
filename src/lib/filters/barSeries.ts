import type {
  BarSource,
  Filter,
  FilterBar,
} from "@alea/lib/filters/types";

/**
 * Both candle streams a filter pipeline operates on, aligned by
 * `openTimeMs`. Pyth is the canonical timeline — `pyth[i]` is the
 * Pyth bar at the i-th canonical timestamp, never `null`. Coinbase
 * is aligned to the same i-th timestamp; `coinbase[i]` is the
 * Coinbase bar at that timestamp, or `null` if Coinbase had a gap
 * there.
 *
 * Invariants:
 *
 *  - `pyth.length === coinbase.length`.
 *  - `pyth[i]?.openTimeMs === coinbase[i]?.openTimeMs` whenever
 *    `coinbase[i]` is non-null.
 *  - Both arrays are strictly ascending by `openTimeMs`.
 *
 * The framework is the only construction site (`alignBarSeries`).
 * Filters should never see this type — they receive a pre-sliced
 * `readonly FilterBar[]` window of their declared `barSource`.
 */
export type AlignedBarSeries = {
  readonly pyth: readonly FilterBar[];
  readonly coinbase: readonly (FilterBar | null)[];
};

/**
 * Builds an `AlignedBarSeries` from a Pyth bar series and a Coinbase
 * bar series that may not be timestamp-identical. Pyth bars define
 * the canonical timeline; Coinbase bars are looked up by
 * `openTimeMs`. Coinbase bars whose timestamps don't appear in Pyth
 * are dropped (we never invent a "Pyth gap" from a Coinbase bar).
 */
export function alignBarSeries({
  pyth,
  coinbase,
}: {
  readonly pyth: readonly FilterBar[];
  readonly coinbase: readonly FilterBar[];
}): AlignedBarSeries {
  const coinbaseByOpenTime = new Map<number, FilterBar>();
  for (const bar of coinbase) {
    coinbaseByOpenTime.set(bar.openTimeMs, bar);
  }
  const aligned: (FilterBar | null)[] = new Array<FilterBar | null>(
    pyth.length,
  ).fill(null);
  for (let i = 0; i < pyth.length; i += 1) {
    const ts = pyth[i]!.openTimeMs;
    aligned[i] = coinbaseByOpenTime.get(ts) ?? null;
  }
  return { pyth, coinbase: aligned };
}

/**
 * Returns the trailing window of length `requiredBars` that ends at
 * (and INCLUDES) index `endInclusive`, sliced from the source
 * declared by the filter.
 *
 *  - Returns `null` if the window would extend below index 0
 *    (warm-up insufficient).
 *  - Returns `null` if the filter's source is `"coinbase"` and any
 *    bar in the window is missing (Coinbase gap).
 *
 * Callers that get `null` should treat the filter as abstaining at
 * this bar — no prediction is made and no engagement is recorded.
 */
export function selectFilterWindow({
  series,
  filter,
  endInclusive,
  requiredBars,
}: {
  readonly series: AlignedBarSeries;
  readonly filter: Pick<Filter<unknown>, "barSource">;
  readonly endInclusive: number;
  readonly requiredBars: number;
}): readonly FilterBar[] | null {
  const start = endInclusive - requiredBars + 1;
  if (start < 0) {
    return null;
  }
  if (filter.barSource === "pyth") {
    return series.pyth.slice(start, endInclusive + 1);
  }
  const window: FilterBar[] = [];
  for (let i = start; i <= endInclusive; i += 1) {
    const bar = series.coinbase[i];
    if (bar === null || bar === undefined) {
      return null;
    }
    window.push(bar);
  }
  return window;
}

/**
 * Same shape as `selectFilterWindow` but slices from the *tail* of a
 * bundle whose absolute index isn't meaningful (live decision path
 * uses a rolling buffer). The bundle here is sized so the most
 * recent bar is at index `series.pyth.length - 1`, and the helper
 * returns the trailing `requiredBars` from that end.
 */
export function selectTrailingFilterWindow({
  series,
  filter,
  requiredBars,
}: {
  readonly series: AlignedBarSeries;
  readonly filter: Pick<Filter<unknown>, "barSource">;
  readonly requiredBars: number;
}): readonly FilterBar[] | null {
  return selectFilterWindow({
    series,
    filter,
    endInclusive: series.pyth.length - 1,
    requiredBars,
  });
}

export function pickBarSourceSeries({
  series,
  source,
}: {
  readonly series: AlignedBarSeries;
  readonly source: BarSource;
}): readonly (FilterBar | null)[] {
  return source === "pyth" ? series.pyth : series.coinbase;
}
