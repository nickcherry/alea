import { REGIME_CELL_MIN_SAMPLES } from "@alea/constants/trading";
import type {
  SurvivalRemainingMinutes,
  SurvivalSnapshot,
} from "@alea/lib/training/computeSurvivalSnapshots";
import type { RegimeAlgo } from "@alea/lib/training/regimeAlgos/types";
import type {
  RegimeAlgoResult,
  RegimeAlgoSummary,
  RegimeBucketResult,
} from "@alea/lib/training/regimeAlgos/resultTypes";
import type {
  SurvivalBucket,
  SurvivalSurface,
  SurvivalSurfaceWithCount,
} from "@alea/lib/training/types";

const REMAINING_VALUES: readonly SurvivalRemainingMinutes[] = [4, 3, 2, 1];


/**
 * Single-pass aggregator: walks the snapshot stream once and, for each
 * algo in `algos`, partitions every snapshot into one of N regime
 * buckets (or skips it when the algo can't classify — warmup /
 * degenerate inputs). Returns the unconditional baseline plus one
 * `RegimeAlgoResult` per algo.
 *
 * Memory: bounded by `algos.length × regimes × bp-range × 4` bucket
 * entries — for the current 2 algos × ≤6 regimes × ~50 bp × 4 remaining
 * slots that's a few thousand entries total. Single linear sweep over
 * the snapshot stream regardless of how many algos are configured.
 */
export function applyRegimeAlgos({
  snapshots,
  algos,
}: {
  readonly snapshots: Iterable<SurvivalSnapshot>;
  readonly algos: readonly RegimeAlgo[];
}): {
  readonly baseline: SurvivalSurfaceWithCount;
  readonly perAlgo: readonly RegimeAlgoResult[];
} {
  const baselineRaw = createRawSurface();
  const baselineWindows = new Set<number>();
  // For each algo, one entry per declared regime + a `skip` counter.
  const perAlgoRaw = algos.map((algo) => ({
    algo,
    perRegime: new Map<string, RawSurface>(
      algo.regimes.map((r) => [r, createRawSurface()]),
    ),
    perRegimeWindows: new Map<string, Set<number>>(
      algo.regimes.map((r) => [r, new Set<number>()]),
    ),
    perRegimeCounts: new Map<string, number>(
      algo.regimes.map((r) => [r, 0]),
    ),
    skipCount: 0,
  }));

  for (const snapshot of snapshots) {
    baselineWindows.add(snapshot.windowStartMs);
    record({
      raw: baselineRaw,
      remaining: snapshot.remaining,
      distanceBp: snapshot.distanceBp,
      survived: snapshot.survived,
    });
    const ctx = snapshot.context;
    const prev5mDir: "up" | "down" | null =
      ctx.prev5mBar === null
        ? null
        : ctx.prev5mBar.close >= ctx.prev5mBar.open
          ? "up"
          : "down";
    for (const slot of perAlgoRaw) {
      const regime = slot.algo.classify({
        leadingSide: snapshot.currentSide,
        ema20: ctx.ema20x5m,
        ema50: ctx.ema50x5m,
        atr14: ctx.atr14x5m,
        atr50: ctx.atr50x5m,
        rsi14: ctx.rsi14x5m,
        atr3: ctx.atr3x5m,
        prev5mDirection: prev5mDir,
      });
      if (regime === null) {
        slot.skipCount += 1;
        continue;
      }
      const surface = slot.perRegime.get(regime);
      if (surface === undefined) {
        throw new Error(
          `regime algo ${slot.algo.id} emitted unknown label ${regime}`,
        );
      }
      record({
        raw: surface,
        remaining: snapshot.remaining,
        distanceBp: snapshot.distanceBp,
        survived: snapshot.survived,
      });
      slot.perRegime.set(regime, surface);
      slot.perRegimeCounts.set(
        regime,
        (slot.perRegimeCounts.get(regime) ?? 0) + 1,
      );
      slot.perRegimeWindows.get(regime)?.add(snapshot.windowStartMs);
    }
  }

  const baseline: SurvivalSurfaceWithCount = {
    windowCount: baselineWindows.size,
    ...materializeSurface({ raw: baselineRaw }),
  };

  const perAlgo: RegimeAlgoResult[] = perAlgoRaw.map((slot) => {
    const buckets: RegimeBucketResult[] = [];
    const halves: SurvivalSurface[] = [];
    let classifiedTotal = 0;
    for (const regime of slot.algo.regimes) {
      const raw = slot.perRegime.get(regime);
      const windows = slot.perRegimeWindows.get(regime);
      const samples = slot.perRegimeCounts.get(regime) ?? 0;
      classifiedTotal += samples;
      if (raw === undefined || windows === undefined) {
        continue;
      }
      const surface: SurvivalSurfaceWithCount = {
        windowCount: windows.size,
        ...materializeSurface({ raw }),
      };
      halves.push(surface);
      buckets.push({
        regime,
        snapshotsTotal: samples,
        windowCount: windows.size,
        surface,
      });
    }
    const snapshotsTotal = classifiedTotal + slot.skipCount;
    void halves; // halves was used by the dropped sweet-spot computation.
    const summary = computeAlgoSummary({
      baseline,
      buckets,
      snapshotsTotal,
      snapshotsClassified: classifiedTotal,
      snapshotsSkipped: slot.skipCount,
    });
    return {
      id: slot.algo.id,
      displayName: slot.algo.displayName,
      description: slot.algo.description,
      params: slot.algo.params,
      version: slot.algo.version,
      baseline,
      buckets,
      summary,
    };
  });

  return { baseline, perAlgo };
}

// ----------------------------------------------------------------
// Bucket accumulation (private; mirrors the survival-filter aggregator
// shape so we share the SurvivalSurface materialization).
// ----------------------------------------------------------------

type RawBucket = { total: number; survived: number };
type RawSurface = Record<SurvivalRemainingMinutes, Map<number, RawBucket>>;

function createRawSurface(): RawSurface {
  return {
    1: new Map(),
    2: new Map(),
    3: new Map(),
    4: new Map(),
  };
}

function record({
  raw,
  remaining,
  distanceBp,
  survived,
}: {
  readonly raw: RawSurface;
  readonly remaining: SurvivalRemainingMinutes;
  readonly distanceBp: number;
  readonly survived: boolean;
}): void {
  const bucket = raw[remaining].get(distanceBp) ?? { total: 0, survived: 0 };
  bucket.total += 1;
  if (survived) {
    bucket.survived += 1;
  }
  raw[remaining].set(distanceBp, bucket);
}

function materializeSurface({
  raw,
}: {
  readonly raw: RawSurface;
}): SurvivalSurface {
  return {
    byRemaining: {
      1: bucketsOf({ map: raw[1] }),
      2: bucketsOf({ map: raw[2] }),
      3: bucketsOf({ map: raw[3] }),
      4: bucketsOf({ map: raw[4] }),
    },
  };
}

function bucketsOf({
  map,
}: {
  readonly map: ReadonlyMap<number, RawBucket>;
}): readonly SurvivalBucket[] {
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([distanceBp, b]) => ({
      distanceBp,
      total: b.total,
      survived: b.survived,
    }));
}

// ----------------------------------------------------------------
// Per-algo summary metrics for the dashboard. We deliberately do NOT
// re-implement the filter framework's signed-area scoring here — for
// N-way regime splits the equivalent question is "how cleanly do these
// regimes separate outcomes from each other and from the baseline"
// and the headline numbers we want for that are different.
// ----------------------------------------------------------------

const PROB_EPSILON = 1e-9;
function clampProb(p: number): number {
  if (p < PROB_EPSILON) {
    return PROB_EPSILON;
  }
  if (p > 1 - PROB_EPSILON) {
    return 1 - PROB_EPSILON;
  }
  return p;
}

function computeAlgoSummary({
  baseline,
  buckets,
  snapshotsTotal,
  snapshotsClassified,
  snapshotsSkipped,
}: {
  readonly baseline: SurvivalSurface;
  readonly buckets: readonly RegimeBucketResult[];
  readonly snapshotsTotal: number;
  readonly snapshotsClassified: number;
  readonly snapshotsSkipped: number;
}): RegimeAlgoSummary {
  // For each `(remaining, distance)` bucket where every regime clears
  // the sample floor, record the spread between the highest and
  // lowest regime win-rate. Reported as a per-rem max so the dashboard
  // can rank algos by "how cleanly do the buckets separate outcomes."
  const maxWinRateSpreadByRemaining = {} as Record<
    SurvivalRemainingMinutes,
    number
  >;
  let maxWinRateSpread = 0;
  // Average info gain per snapshot, summed across regimes vs the
  // global baseline. Same numerator as the filter framework's
  // calibrationScore; lets you compare regime algos head-to-head with
  // the binary filters even if the per-cell semantics differ.
  let totalNatsSavedVsGlobal = 0;
  for (const remaining of REMAINING_VALUES) {
    const baselineByDistance = new Map<number, SurvivalBucket>();
    for (const b of baseline.byRemaining[remaining]) {
      baselineByDistance.set(b.distanceBp, b);
    }
    let remMaxSpread = 0;
    const distancesAcross = new Set<number>();
    for (const bucket of buckets) {
      for (const cell of bucket.surface.byRemaining[remaining]) {
        distancesAcross.add(cell.distanceBp);
        if (cell.total < REGIME_CELL_MIN_SAMPLES) {
          continue;
        }
        const baselineCell = baselineByDistance.get(cell.distanceBp);
        if (
          baselineCell === undefined ||
          baselineCell.total < REGIME_CELL_MIN_SAMPLES
        ) {
          continue;
        }
        const cellP = clampProb(cell.survived / cell.total);
        const baselineP = clampProb(
          baselineCell.survived / baselineCell.total,
        );
        const survived = cell.survived;
        const failed = cell.total - cell.survived;
        const cellLogLoss =
          -survived * Math.log(cellP) - failed * Math.log(1 - cellP);
        const baselineLogLoss =
          -survived * Math.log(baselineP) - failed * Math.log(1 - baselineP);
        totalNatsSavedVsGlobal += Math.max(0, baselineLogLoss - cellLogLoss);
      }
    }
    for (const distance of distancesAcross) {
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      let allClear = true;
      for (const bucket of buckets) {
        const cell = bucket.surface.byRemaining[remaining].find(
          (c) => c.distanceBp === distance,
        );
        if (cell === undefined || cell.total < REGIME_CELL_MIN_SAMPLES) {
          allClear = false;
          break;
        }
        const rate = cell.survived / cell.total;
        if (rate < lo) {
          lo = rate;
        }
        if (rate > hi) {
          hi = rate;
        }
      }
      if (allClear && hi > Number.NEGATIVE_INFINITY) {
        const spread = hi - lo;
        if (spread > remMaxSpread) {
          remMaxSpread = spread;
        }
        if (spread > maxWinRateSpread) {
          maxWinRateSpread = spread;
        }
      }
    }
    maxWinRateSpreadByRemaining[remaining] = remMaxSpread;
  }
  const calibrationScore =
    snapshotsTotal === 0 ? 0 : totalNatsSavedVsGlobal / snapshotsTotal;
  return {
    snapshotsTotal,
    snapshotsClassified,
    snapshotsSkipped,
    calibrationScore,
    maxWinRateSpread,
    maxWinRateSpreadByRemaining,
  };
}
