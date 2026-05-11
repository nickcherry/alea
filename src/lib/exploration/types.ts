import type { FilterFamily } from "@alea/lib/filters/types";
import type { CandleTimeframe } from "@alea/types/candles";

/**
 * One filter's co-firing relationship with another. Jaccard is the
 * fraction of (asset, ts_ms) cells where BOTH filters fired out of
 * the union where EITHER fired — symmetric, 0..1. Pulled per period
 * because two filters can be correlated on 5m bars but uncorrelated
 * on 15m bars (or vice versa).
 */
export type FilterPeerOverlap = {
  readonly otherFilterId: string;
  readonly otherFamily: FilterFamily;
  readonly jaccard: number;
};

/**
 * Per-quarter slice of a candidate's engagements, aggregated across
 * every asset. `label` is the canonical "YYYY-QN" string (e.g.
 * "2025-Q1"); the dashboard sorts chronologically by (year, quarter).
 * Win rate is decimal `[0, 1]` or `null` when the quarter had zero
 * fires (rare — implies every asset was outside its trading window).
 */
export type ExplorationQuarter = {
  readonly label: string;
  readonly year: number;
  readonly quarter: number;
  readonly nFires: number;
  readonly nWins: number;
  readonly winRate: number | null;
};

/**
 * One backtested candidate at one timeframe, aggregated across every
 * asset in the universe. A filter that crushes on xrp but flops on
 * btc/eth/sol shows up here as a single number that reflects all of
 * them — exactly the view the trader wants because we'll deploy any
 * promoted candidate across the whole asset set.
 *
 * Row identity (`id`) is `"{filter_id}|{filter_version}|{config_canon}|{period}"`.
 * `winRate` and `ciLow`/`ciHigh` are decimals in `[0, 1]`. The 95%
 * Wilson interval is computed on the aggregate counts.
 *
 * `quarters` is the chronological list of per-quarter slices, each
 * summed across assets. `quarterWinRateMin` / `quarterWinRateMax`
 * summarise the spread — a tight spread means stable across regimes.
 */
export type ExplorationCandidateRow = {
  readonly id: string;
  readonly filterId: string;
  readonly filterVersion: number;
  readonly config: unknown;
  readonly configCanon: string;
  readonly period: CandleTimeframe;
  readonly nBars: number;
  readonly nFires: number;
  readonly nWins: number;
  readonly winRate: number | null;
  readonly ciLow: number;
  readonly ciHigh: number;
  readonly nFiresUp: number;
  readonly nWinsUp: number;
  readonly winRateUp: number | null;
  readonly nFiresDown: number;
  readonly nWinsDown: number;
  readonly winRateDown: number | null;
  readonly quarters: readonly ExplorationQuarter[];
  readonly quarterWinRateMin: number | null;
  readonly quarterWinRateMax: number | null;
  /**
   * Which strategy family this filter belongs to. This is distinct
   * from market regime.
   */
  readonly family: FilterFamily;
  /**
   * Top other filter families this filter fires alongside, sorted
   * by Jaccard descending. Computed per-period so we can spot
   * "effectively the same signal" pairs.
   */
  readonly topPeers: readonly FilterPeerOverlap[];
  /**
   * Per-market-regime stratification of this candidate's fires.
   * Map keys are `MarketRegime` strings (e.g. "low_vol_trending").
   * Missing entries mean the regime had zero fires for this row.
   * Only populated when `bar_regimes` is non-empty — empty before
   * the backfill runs.
   */
  readonly byRegime: Readonly<Record<string, ExplorationRegimeStats>>;
};

/**
 * Aggregated fire/win counts and Wilson CI for one (candidate,
 * regime) cell. `quarters` is the chronological per-quarter slice
 * within this regime — same shape as the all-bars `quarters` array
 * on the parent row but filtered to fires that happened while the
 * market was in this regime.
 */
export type ExplorationRegimeStats = {
  readonly nFires: number;
  readonly nWins: number;
  readonly winRate: number | null;
  readonly ciLow: number;
  readonly ciHigh: number;
  readonly nFiresUp: number;
  readonly nWinsUp: number;
  readonly winRateUp: number | null;
  readonly nFiresDown: number;
  readonly nWinsDown: number;
  readonly winRateDown: number | null;
  readonly quarters: readonly ExplorationQuarter[];
  readonly quarterWinRateMin: number | null;
  readonly quarterWinRateMax: number | null;
};

export type ExplorationPayload = {
  readonly generatedAtMs: number;
  readonly rowCount: number;
  readonly rows: readonly ExplorationCandidateRow[];
};
