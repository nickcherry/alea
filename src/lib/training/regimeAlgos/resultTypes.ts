import type { SurvivalRemainingMinutes } from "@alea/lib/training/computeSurvivalSnapshots";
import type { SurvivalSurfaceWithCount } from "@alea/lib/training/types";

/**
 * One regime bucket's full result: the survival surface restricted to
 * snapshots that landed in this bucket, plus the snapshot count and
 * the number of distinct windows it touched.
 */
export type RegimeBucketResult = {
  readonly regime: string;
  readonly snapshotsTotal: number;
  readonly windowCount: number;
  readonly surface: SurvivalSurfaceWithCount;
};

/**
 * Per-algo summary metrics for the dashboard.
 *
 * `calibrationScore`: average information gain in nats per snapshot
 * across all regimes vs the global baseline. Same units as the binary
 * filter framework's `calibrationScore` so the two are head-to-head
 * comparable.
 *
 * `maxWinRateSpread`: across every `(remaining, distance)` bucket where
 * EVERY regime clears the sample floor, the largest highest-vs-lowest
 * regime hold-rate gap. Direct, intuitive answer to "how cleanly do
 * these buckets separate outcomes."
 */
export type RegimeAlgoSummary = {
  readonly snapshotsTotal: number;
  readonly snapshotsClassified: number;
  readonly snapshotsSkipped: number;
  readonly calibrationScore: number;
  readonly maxWinRateSpread: number;
  readonly maxWinRateSpreadByRemaining: Readonly<
    Record<SurvivalRemainingMinutes, number>
  >;
};

/**
 * Per-algo full result the dashboard renderer consumes. Mirrors the
 * shape of `SurvivalFilterResult` in the binary filter framework so
 * the renderer can reuse most of the same scaffolding (chart,
 * sweet-spot overlay, summary header) for both section types.
 */
export type RegimeAlgoResult = {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly params: Readonly<Record<string, number>>;
  readonly version: number;
  readonly baseline: SurvivalSurfaceWithCount;
  readonly buckets: readonly RegimeBucketResult[];
  readonly summary: RegimeAlgoSummary;
};
