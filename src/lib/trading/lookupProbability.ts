import type {
  AssetProbabilities,
  LeadingRegimeTable,
  ProbabilityBucket,
  ProbabilitySurface,
  ProbabilityTable,
  RemainingMinutes,
} from "@alea/lib/trading/types";
import type { Asset } from "@alea/types/assets";

export type ProbabilityLookup = {
  readonly algoId: string;
  readonly regime: string;
  readonly distanceBp: number;
  readonly probability: number;
  readonly samples: number;
};

/**
 * Iterates every leading-regime table for the given asset and returns
 * one `ProbabilityLookup` per entry where `(regime, remaining,
 * distanceBp)` resolves to a populated bucket. The caller is expected
 * to know which regime each algo classified the snapshot into — pass
 * that as `regimesByAlgoId`. Algos missing from the map (warmup, the
 * algo's classifier returned null, etc.) contribute nothing.
 *
 * The decision evaluator iterates the returned array, derives per-side
 * probabilities from each entry, and trades on the side with the
 * largest edge across all (lookup, side) tuples — the "any algo gives
 * me actionable signal → trade" greedy strategy.
 */
export function lookupAllProbabilities({
  table,
  asset,
  regimesByAlgoId,
  remaining,
  distanceBp,
}: {
  readonly table: ProbabilityTable;
  readonly asset: Asset;
  readonly regimesByAlgoId: ReadonlyMap<string, string>;
  readonly remaining: RemainingMinutes;
  readonly distanceBp: number;
}): readonly ProbabilityLookup[] {
  const assetEntry = findAsset({ table, asset });
  if (assetEntry === null) {
    return [];
  }
  const out: ProbabilityLookup[] = [];
  for (const entry of assetEntry.leadingTables) {
    const classifiedRegime = regimesByAlgoId.get(entry.algoId);
    if (classifiedRegime === undefined || classifiedRegime !== entry.regime) {
      continue;
    }
    const bucket = findBucket({
      surface: entry.surface,
      remaining,
      distanceBp,
    });
    if (bucket === null) {
      continue;
    }
    out.push({
      algoId: entry.algoId,
      regime: entry.regime,
      distanceBp: bucket.distanceBp,
      probability: bucket.probability,
      samples: bucket.samples,
    });
  }
  return out;
}

/**
 * Diagnostic helper for the dry-run logger and the live decision
 * snapshot. Returns the full set of leading-regime entries the
 * snapshot intersects (regardless of whether each has a populated
 * bucket at the requested distance). Useful for explaining "why did
 * we skip" — e.g. classified into one algo's leading regime but the
 * specific bp bucket was empty.
 */
export function leadingRegimeMatches({
  table,
  asset,
  regimesByAlgoId,
}: {
  readonly table: ProbabilityTable;
  readonly asset: Asset;
  readonly regimesByAlgoId: ReadonlyMap<string, string>;
}): readonly LeadingRegimeTable[] {
  const assetEntry = findAsset({ table, asset });
  if (assetEntry === null) {
    return [];
  }
  const out: LeadingRegimeTable[] = [];
  for (const entry of assetEntry.leadingTables) {
    const classified = regimesByAlgoId.get(entry.algoId);
    if (classified !== undefined && classified === entry.regime) {
      out.push(entry);
    }
  }
  return out;
}

function findAsset({
  table,
  asset,
}: {
  readonly table: ProbabilityTable;
  readonly asset: Asset;
}): AssetProbabilities | null {
  for (const entry of table.assets) {
    if (entry.asset === asset) {
      return entry;
    }
  }
  return null;
}

function findBucket({
  surface,
  remaining,
  distanceBp,
}: {
  readonly surface: ProbabilitySurface;
  readonly remaining: RemainingMinutes;
  readonly distanceBp: number;
}): ProbabilityBucket | null {
  const buckets = surface.byRemaining[remaining];
  for (const bucket of buckets) {
    if (bucket.distanceBp === distanceBp) {
      return bucket;
    }
    if (bucket.distanceBp > distanceBp) {
      return null;
    }
  }
  return null;
}
