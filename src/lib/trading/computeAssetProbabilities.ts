import {
  LEADING_REGIME_MIN_LEAD_PP,
  LIVE_TRADING_REGIME_ALGOS,
  MIN_ACTIONABLE_DISTANCE_BP,
  REGIME_CELL_MIN_SAMPLES,
} from "@alea/constants/trading";
import type {
  AssetProbabilities,
  LeadingRegimeTable,
  ProbabilityBucket,
  ProbabilitySurface,
  RemainingMinutes,
} from "@alea/lib/trading/types";
import { computeSurvivalSnapshots } from "@alea/lib/training/computeSurvivalSnapshots";
import type {
  RegimeAlgo,
  RegimeClassifierInput,
} from "@alea/lib/training/regimeAlgos/types";
import type { Asset } from "@alea/types/assets";
import type { Candle } from "@alea/types/candles";


/**
 * Computes the per-asset slice of the production probability table.
 *
 * Walks the historical snapshot stream once, then for each algo in
 * `LIVE_TRADING_REGIME_ALGOS`:
 *
 *   1. Partitions the same snapshots into the algo's regime buckets;
 *   2. Computes each regime's average pp lead vs the unconditional
 *      baseline (sample-weighted across (remaining, bp) cells where
 *      both clear `REGIME_CELL_MIN_SAMPLES`);
 *   3. Persists a `LeadingRegimeTable` for each regime whose
 *      `avgLeadPp >= LEADING_REGIME_MIN_LEAD_PP`.
 *
 * The live decision evaluator iterates these tables and trades on
 * whichever (algo, regime, side) gives the highest edge — the "greedy
 * any-algo" strategy. Lagging regimes (negative or near-zero lead) are
 * excluded: they'd contribute below-baseline probabilities the
 * MIN_MODEL_PROBABILITY gate would reject anyway.
 *
 * Buckets thinner than `minBucketSamples` are dropped per surface.
 *
 * Returns `null` when no usable windows exist (cold series, no warmup
 * data) or when no algo produced a single leading regime (would be a
 * signal that something's wrong with the data or the algos).
 */
export function computeAssetProbabilities({
  asset,
  candles1m,
  candles5m,
  minBucketSamples,
  regimeAlgos = LIVE_TRADING_REGIME_ALGOS,
  minLeadPp = LEADING_REGIME_MIN_LEAD_PP,
}: {
  readonly asset: Asset;
  readonly candles1m: readonly Candle[];
  readonly candles5m: readonly Candle[];
  readonly minBucketSamples: number;
  readonly regimeAlgos?: readonly RegimeAlgo[];
  readonly minLeadPp?: number;
}): AssetProbabilities | null {
  // Per (algo, regime), accumulate the raw surface as we walk
  // snapshots. Plus the unconditional baseline (used to compute each
  // regime's pp-lead later) and the per-regime window counts (used
  // for the windowShare on the persisted entry).
  const baselineRaw = createRawSurface();
  const allWindows = new Set<number>();
  const perAlgo = regimeAlgos.map((algo) => ({
    algo,
    perRegime: new Map<string, RawSurface>(
      algo.regimes.map((r) => [r, createRawSurface()]),
    ),
    perRegimeWindows: new Map<string, Set<number>>(
      algo.regimes.map((r) => [r, new Set<number>()]),
    ),
  }));

  for (const snapshot of computeSurvivalSnapshots({ candles1m, candles5m })) {
    allWindows.add(snapshot.windowStartMs);
    accumulate({ surface: baselineRaw, snapshot });
    const ctx = snapshot.context;
    const prev5mDir: "up" | "down" | null =
      ctx.prev5mBar === null
        ? null
        : ctx.prev5mBar.close >= ctx.prev5mBar.open
          ? "up"
          : "down";
    const input: RegimeClassifierInput = {
      leadingSide: snapshot.currentSide,
      ema20: ctx.ema20x5m,
      ema50: ctx.ema50x5m,
      atr14: ctx.atr14x5m,
      atr50: ctx.atr50x5m,
      rsi14: ctx.rsi14x5m,
      atr3: ctx.atr3x5m,
      prev5mDirection: prev5mDir,
    };
    for (const slot of perAlgo) {
      const regime = slot.algo.classify(input);
      if (regime === null) {
        continue;
      }
      const target = slot.perRegime.get(regime);
      if (target === undefined) {
        throw new Error(
          `regime algo ${slot.algo.id} emitted unknown label ${regime}`,
        );
      }
      accumulate({ surface: target, snapshot });
      slot.perRegimeWindows.get(regime)?.add(snapshot.windowStartMs);
    }
  }

  if (allWindows.size === 0) {
    return null;
  }

  const baselineByRD = indexByRemainingDistance({ raw: baselineRaw });
  const leadingTables: LeadingRegimeTable[] = [];

  for (const slot of perAlgo) {
    for (const regime of slot.algo.regimes) {
      const raw = slot.perRegime.get(regime);
      const windows = slot.perRegimeWindows.get(regime);
      if (raw === undefined || windows === undefined) {
        continue;
      }
      // avgLeadPp: sample-weighted (by regime cell sample count) mean
      // of (regime hold rate − baseline hold rate) across cells where
      // both clear the sample floor and distance is actionable.
      const avgLeadPp = computeAvgLeadPp({ raw, baselineByRD });
      if (avgLeadPp === null || avgLeadPp < minLeadPp) {
        continue;
      }
      const surface = materializeSurface({ raw, minBucketSamples });
      if (isSurfaceEmpty({ surface })) {
        continue;
      }
      leadingTables.push({
        algoId: slot.algo.id,
        regime,
        windowShare: windows.size / allWindows.size,
        avgLeadPp,
        surface,
      });
    }
  }

  if (leadingTables.length === 0) {
    return null;
  }
  return {
    asset,
    windowCount: allWindows.size,
    leadingTables,
  };
}

type RawBucket = { total: number; survived: number };
type RawSurface = Record<RemainingMinutes, Map<number, RawBucket>>;

function createRawSurface(): RawSurface {
  return {
    1: new Map(),
    2: new Map(),
    3: new Map(),
    4: new Map(),
  };
}

function accumulate({
  surface,
  snapshot,
}: {
  readonly surface: RawSurface;
  readonly snapshot: {
    readonly remaining: RemainingMinutes;
    readonly distanceBp: number;
    readonly survived: boolean;
  };
}): void {
  const bucket = surface[snapshot.remaining].get(snapshot.distanceBp) ?? {
    total: 0,
    survived: 0,
  };
  bucket.total += 1;
  if (snapshot.survived) {
    bucket.survived += 1;
  }
  surface[snapshot.remaining].set(snapshot.distanceBp, bucket);
}

function indexByRemainingDistance({
  raw,
}: {
  readonly raw: RawSurface;
}): Record<RemainingMinutes, ReadonlyMap<number, RawBucket>> {
  return raw;
}

function computeAvgLeadPp({
  raw,
  baselineByRD,
}: {
  readonly raw: RawSurface;
  readonly baselineByRD: Record<RemainingMinutes, ReadonlyMap<number, RawBucket>>;
}): number | null {
  let numerator = 0;
  let denominator = 0;
  const remainings: RemainingMinutes[] = [4, 3, 2, 1];
  for (const remaining of remainings) {
    const baselineMap = baselineByRD[remaining];
    for (const [distanceBp, cell] of raw[remaining]) {
      if (distanceBp < MIN_ACTIONABLE_DISTANCE_BP) continue;
      if (cell.total < REGIME_CELL_MIN_SAMPLES) continue;
      const baselineCell = baselineMap.get(distanceBp);
      if (
        baselineCell === undefined ||
        baselineCell.total < REGIME_CELL_MIN_SAMPLES
      ) {
        continue;
      }
      const regimeRate = (cell.survived / cell.total) * 100;
      const baselineRate = (baselineCell.survived / baselineCell.total) * 100;
      const deltaPp = regimeRate - baselineRate;
      numerator += deltaPp * cell.total;
      denominator += cell.total;
    }
  }
  if (denominator === 0) return null;
  return numerator / denominator;
}

function materializeSurface({
  raw,
  minBucketSamples,
}: {
  readonly raw: RawSurface;
  readonly minBucketSamples: number;
}): ProbabilitySurface {
  return {
    byRemaining: {
      1: bucketsOf({ map: raw[1], minBucketSamples }),
      2: bucketsOf({ map: raw[2], minBucketSamples }),
      3: bucketsOf({ map: raw[3], minBucketSamples }),
      4: bucketsOf({ map: raw[4], minBucketSamples }),
    },
  };
}

function isSurfaceEmpty({
  surface,
}: {
  readonly surface: ProbabilitySurface;
}): boolean {
  for (const remaining of [4, 3, 2, 1] as const) {
    if (surface.byRemaining[remaining].length > 0) {
      return false;
    }
  }
  return true;
}

function bucketsOf({
  map,
  minBucketSamples,
}: {
  readonly map: ReadonlyMap<number, RawBucket>;
  readonly minBucketSamples: number;
}): readonly ProbabilityBucket[] {
  const distances = [...map.keys()].sort((a, b) => a - b);
  const out: ProbabilityBucket[] = [];
  for (const distanceBp of distances) {
    if (distanceBp < MIN_ACTIONABLE_DISTANCE_BP) {
      continue;
    }
    const bucket = map.get(distanceBp);
    if (bucket === undefined || bucket.total < minBucketSamples) {
      continue;
    }
    out.push({
      distanceBp,
      samples: bucket.total,
      probability: bucket.survived / bucket.total,
    });
  }
  return out;
}
