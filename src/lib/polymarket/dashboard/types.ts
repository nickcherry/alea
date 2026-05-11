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
