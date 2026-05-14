import type { LeadTimeDriftPayload } from "@alea/lib/polymarket/dashboard/loadLeadTimeDriftPayload";
import type { ResolutionTimeframe } from "@alea/types/resolutions";

/**
 * Bucket boundary for the "by candle size" histogram, expressed in
 * absolute percent move (open→close). Each `upperPct` row counts
 * windows where `0 ≤ |move%| < upperPct`. `upperPct = null` is the
 * unbounded tail bucket (≥ the previous boundary). See
 * `MOVE_BUCKETS_PCT` in `loadProxyAccuracyPayload.ts` for canonical
 * edges.
 */
export type ProxyMoveBucket = {
  readonly upperPct: number | null;
  /**
   * Display label like `< 1 bp` or `1–2 bp` — the loader fills this in
   * so the renderer doesn't have to know unit math.
   */
  readonly label: string;
  /**
   * Count of windows whose |move%| falls in this bucket, restricted to
   * the parent group (overall / per-asset / disagreement-only).
   */
  readonly count: number;
};

export type ProxyAccuracyAggregate = {
  /**
   * Total joined (poly + pyth) windows in this group.
   */
  readonly total: number;
  readonly agreed: number;
  readonly disagreed: number;
  /**
   * `agreed / total` — `null` when total = 0.
   */
  readonly agreementRate: number | null;
  /**
   * Mean / median absolute move % among disagreements only. Both are
   * `null` when there are no disagreements in this group.
   */
  readonly disagreeMeanMovePct: number | null;
  readonly disagreeMedianMovePct: number | null;
  readonly disagreeP90MovePct: number | null;
  /**
   * `clearMovePct` is the threshold we use to call a disagreement
   * "clear" rather than "noisy boundary jitter". Currently mirrors the
   * `TRAINING_OUTCOME_MIN_ABS_MOVE_PCT` constant.
   */
  readonly clearMovePct: number;
  /**
   * Windows where Polymarket and Pyth disagreed AND the Pyth bar moved
   * at least `clearMovePct`. These are the dangerous disagreements:
   * tiny moves can flip sign on boundary jitter, but a clear directional
   * move that lands opposite settlement is real proxy drift.
   */
  readonly clearDisagreements: number;
  /**
   * Among disagreements, share whose |move%| is below `clearMovePct`.
   * High share = disagreements are mostly boundary noise; low share =
   * we're losing real-direction calls.
   */
  readonly disagreeBelowClearShare: number | null;
  /**
   * Histogram of |move%| restricted to disagreements only. Same buckets
   * as `moveBucketsAll` so the renderer can show both side-by-side.
   */
  readonly moveBucketsDisagree: readonly ProxyMoveBucket[];
};

export type ProxyAccuracyAssetRow = {
  readonly asset: string;
  readonly aggregate: ProxyAccuracyAggregate;
};

export type ProxyAccuracyTimeframeBreakdown = {
  readonly timeframe: ResolutionTimeframe;
  readonly aggregate: ProxyAccuracyAggregate;
  readonly perAsset: readonly ProxyAccuracyAssetRow[];
  /**
   * Histogram of |move%| over every joined window in the timeframe
   * (agreements + disagreements). Lets the dashboard show whether
   * disagreements are concentrated at the low end of the move
   * distribution where most bars live anyway, or genuinely
   * over-represented at clearer moves.
   */
  readonly moveBucketsAll: readonly ProxyMoveBucket[];
};

export type ProxyAccuracyDisagreement = {
  readonly asset: string;
  readonly timeframe: ResolutionTimeframe;
  readonly windowStartTsMs: number;
  readonly polyOutcome: "up" | "down";
  readonly pythOutcome: "up" | "down";
  readonly pythOpen: number;
  readonly pythClose: number;
  readonly absMovePct: number;
};

export type ProxyAccuracyCoverage = {
  readonly polymarketRows: number;
  /**
   * Joined rows = both Polymarket settlement and a Pyth candle exist
   * for the same window. The dashboard's numbers are all over joined
   * rows; coverage explains the difference vs. raw Polymarket counts.
   */
  readonly joinedRows: number;
  /**
   * Polymarket rows that resolved as `void` (refund / dispute). Skipped
   * from agreement math because there's nothing to compare.
   */
  readonly voidRows: number;
  /**
   * Polymarket rows with no corresponding Pyth candle. Usually a small
   * tail (e.g. the most recent windows where Pyth sync hasn't run).
   */
  readonly missingPythRows: number;
  readonly firstWindowMs: number | null;
  readonly lastWindowMs: number | null;
};

export type ProxyAccuracyPayload = {
  readonly generatedAtMs: number;
  readonly coverage: ProxyAccuracyCoverage;
  readonly trainingThresholdPct: number;
  readonly breakdowns: readonly ProxyAccuracyTimeframeBreakdown[];
  /**
   * The most-extreme disagreements (largest absolute move %), capped at
   * the loader's hard limit. Surfaced in the audit table so an operator
   * can sanity-check whether the big disagreements look like proxy
   * drift or like edge cases (asset launch, gamma latency, etc).
   */
  readonly extremeDisagreements: readonly ProxyAccuracyDisagreement[];
};

export type PricePathHeatmapColumn = {
  /**
   * Center of this elapsed-time bucket, expressed as milliseconds before
   * market close. The dashboard renders this as labels like `T-4:30`.
   */
  readonly timeRemainingMs: number;
  readonly sampleCount: number;
  /**
   * Counts by rounded UP price cents, index 0..100.
   */
  readonly counts: readonly number[];
};

export type PricePathBandPoint = {
  readonly timeRemainingMs: number;
  readonly sampleCount: number;
  readonly withinOneCentShare: number | null;
  readonly withinTwoCentShare: number | null;
  readonly withinFiveCentShare: number | null;
  readonly p50DistanceCents: number | null;
  readonly p75DistanceCents: number | null;
  readonly p90DistanceCents: number | null;
};

export type PricePathMarkerShare = {
  readonly timeRemainingMs: number;
  readonly label: string;
  readonly sampleCount: number;
  readonly withinOneCentShare: number | null;
};

/**
 * Per-time-bucket count of 50c-crossings. A "crossing" is a consecutive
 * pair of samples within the same window where one is at or above 50c
 * and the other strictly below; we bucket the event by the
 * `timeRemainingMs` of the second sample. `windowsObserved` is the
 * count of windows that had any sample in this bucket — the natural
 * denominator for `windowsWithCrossing / windowsObserved`. The chart
 * and table on the price-paths page both render one row per bucket.
 */
export type PricePathCrossingBucket = {
  readonly timeRemainingMs: number;
  readonly windowsObserved: number;
  readonly windowsWithCrossing: number;
  readonly crossingCount: number;
};

export type PricePathCrossings = {
  readonly totalWindows: number;
  readonly windowsWithAnyCrossing: number;
  readonly totalCrossings: number;
  readonly meanCrossingsPerWindow: number | null;
  readonly buckets: readonly PricePathCrossingBucket[];
};

export type PricePathAggregateSlice = {
  readonly asset: string | null;
  readonly label: string;
  readonly windowCount: number;
  readonly sampleCount: number;
  readonly firstWindowMs: number | null;
  readonly lastWindowMs: number | null;
  readonly overallWithinOneCentShare: number | null;
  readonly overallWithinTwoCentShare: number | null;
  readonly overallWithinFiveCentShare: number | null;
  readonly medianDistanceCents: number | null;
  readonly p90DistanceCents: number | null;
  readonly heatmap: {
    readonly priceBucketsCents: readonly number[];
    readonly columns: readonly PricePathHeatmapColumn[];
    readonly maxColumnShare: number;
  };
  readonly bandSeries: readonly PricePathBandPoint[];
  readonly markerShares: readonly PricePathMarkerShare[];
  readonly crossings: PricePathCrossings;
};

export type PricePathTimeframeBreakdown = {
  readonly timeframe: ResolutionTimeframe;
  readonly durationMs: number;
  readonly timeBucketMs: number;
  readonly tableMarkersMs: readonly number[];
  readonly slices: readonly PricePathAggregateSlice[];
};

export type PricePathsPayload = {
  readonly generatedAtMs: number;
  readonly lookbackDays: number;
  readonly cutoffMs: number;
  readonly windowCount: number;
  readonly sampleCount: number;
  readonly firstWindowMs: number | null;
  readonly lastWindowMs: number | null;
  readonly breakdowns: readonly PricePathTimeframeBreakdown[];
  readonly leadTimeDrift: LeadTimeDriftPayload;
};
