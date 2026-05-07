import { trainingCandleSeries } from "@alea/constants/training";
import type { DatabaseClient } from "@alea/lib/db/types";
import type {
  RegimeAlgoCacheManifest,
  SizeDistributionCacheManifest,
  SurvivalDistributionCacheManifest,
  SurvivalFilterCacheManifest,
} from "@alea/lib/training/cache/cacheManifests";
import type { TrainingCacheStore } from "@alea/lib/training/cache/cacheStore";
import {
  computeCandleSizeDistribution,
  SIZE_DISTRIBUTION_VERSION,
} from "@alea/lib/training/computeCandleSizeDistribution";
import {
  computeSurvivalSnapshots,
  SNAPSHOT_PIPELINE_VERSION,
} from "@alea/lib/training/computeSurvivalSnapshots";
import { loadMaxCandleTimestamp } from "@alea/lib/training/loadMaxCandleTimestamp";
import { loadTrainingCandles } from "@alea/lib/training/loadTrainingCandles";
import { applyRegimeAlgos } from "@alea/lib/training/regimeAlgos/applyRegimeAlgos";
import { regimeAlgos } from "@alea/lib/training/regimeAlgos/registry";
import type { RegimeAlgoResult } from "@alea/lib/training/regimeAlgos/resultTypes";
import type { RegimeAlgo } from "@alea/lib/training/regimeAlgos/types";
import { applySurvivalFilters } from "@alea/lib/training/survivalFilters/applySurvivalFilters";
import { survivalFilters } from "@alea/lib/training/survivalFilters/registry";
import type { SurvivalFilter } from "@alea/lib/training/survivalFilters/types";
import type {
  AssetRegimeAlgos,
  AssetSizeDistribution,
  AssetSurvivalDistribution,
  AssetSurvivalFilters,
  SurvivalFilterResultPayload,
  TrainingDistributionsPayload,
} from "@alea/lib/training/types";
import type { Asset } from "@alea/types/assets";

/**
 * One-asset slice of the training distributions dashboard: size
 * distribution, survival distribution (or null if 1m candles aren't
 * synced), per-filter results (or null), plus cache instrumentation
 * for the per-asset summary line.
 */
export type TrainingAssetResult = {
  readonly distribution: AssetSizeDistribution;
  readonly survival: AssetSurvivalDistribution | null;
  readonly filterResults: AssetSurvivalFilters | null;
  readonly regimeAlgoResults: AssetRegimeAlgos | null;
  readonly cacheHits: number;
  readonly cacheTotal: number;
};

/**
 * Runs the full per-asset pipeline against the cache. Loads only what
 * the cache forced us to load: a fully-cached asset doesn't touch the
 * candles table at all (just the cheap `MAX(timestamp)` probes).
 */
export async function processTrainingAsset({
  db,
  asset,
  cache,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly cache: TrainingCacheStore | null;
}): Promise<TrainingAssetResult | null> {
  const lastCandleMs5m = await loadMaxCandleTimestamp({ db, asset });
  if (lastCandleMs5m === null) {
    return null;
  }
  const lastCandleMs1m = await loadMaxCandleTimestamp({
    db,
    asset,
    timeframe: "1m",
  });

  const sizeManifest: SizeDistributionCacheManifest = {
    kind: "size",
    series: trainingCandleSeries,
    asset,
    lastCandleMs5m,
    algoVersion: SIZE_DISTRIBUTION_VERSION,
  };
  const cachedSize =
    cache === null
      ? null
      : await cache.get<AssetSizeDistribution>({ manifest: sizeManifest });

  let survivalManifest: SurvivalDistributionCacheManifest | null = null;
  let cachedSurvival: AssetSurvivalDistribution | null = null;
  const filterCacheState: {
    filter: SurvivalFilter;
    manifest: SurvivalFilterCacheManifest;
    cached: SurvivalFilterResultPayload | null;
  }[] = [];

  if (lastCandleMs1m !== null) {
    survivalManifest = {
      kind: "survival",
      series: trainingCandleSeries,
      asset,
      lastCandleMs1m,
      lastCandleMs5m,
      pipelineVersion: SNAPSHOT_PIPELINE_VERSION,
    };
    cachedSurvival =
      cache === null
        ? null
        : await cache.get<AssetSurvivalDistribution>({
            manifest: survivalManifest,
          });
    for (const filter of survivalFilters) {
      const manifest: SurvivalFilterCacheManifest = {
        kind: "filter",
        series: trainingCandleSeries,
        asset,
        lastCandleMs1m,
        lastCandleMs5m,
        pipelineVersion: SNAPSHOT_PIPELINE_VERSION,
        filterId: filter.id,
        filterVersion: filter.version,
      };
      const cached =
        cache === null
          ? null
          : await cache.get<SurvivalFilterResultPayload>({ manifest });
      filterCacheState.push({ filter, manifest, cached });
    }
  }

  const regimeAlgoCacheState: {
    algo: RegimeAlgo;
    manifest: RegimeAlgoCacheManifest;
    cached: RegimeAlgoResult | null;
  }[] = [];
  if (lastCandleMs1m !== null) {
    for (const algo of regimeAlgos) {
      const manifest: RegimeAlgoCacheManifest = {
        kind: "regime",
        series: trainingCandleSeries,
        asset,
        lastCandleMs1m,
        lastCandleMs5m,
        pipelineVersion: SNAPSHOT_PIPELINE_VERSION,
        algoId: algo.id,
        algoVersion: algo.version,
      };
      const cached =
        cache === null
          ? null
          : await cache.get<RegimeAlgoResult>({ manifest });
      regimeAlgoCacheState.push({ algo, manifest, cached });
    }
  }

  const needSize = cachedSize === null;
  const needSurvival = lastCandleMs1m !== null && cachedSurvival === null;
  const missingFilters = filterCacheState.filter((s) => s.cached === null);
  const needAnyFilter = missingFilters.length > 0;
  const missingRegimeAlgos = regimeAlgoCacheState.filter(
    (s) => s.cached === null,
  );
  const needAnyRegimeAlgo = missingRegimeAlgos.length > 0;
  const needSnapshotPass = needSurvival || needAnyFilter || needAnyRegimeAlgo;

  // Bookkeeping for the per-asset summary line: hits / total across the
  // size + survival + per-filter + per-regime-algo cache layers.
  const cacheTotal =
    1 +
    (lastCandleMs1m !== null ? 1 : 0) +
    filterCacheState.length +
    regimeAlgoCacheState.length;
  const cacheHits =
    (cachedSize === null ? 0 : 1) +
    (cachedSurvival === null ? 0 : 1) +
    filterCacheState.reduce((acc, s) => acc + (s.cached === null ? 0 : 1), 0) +
    regimeAlgoCacheState.reduce(
      (acc, s) => acc + (s.cached === null ? 0 : 1),
      0,
    );

  // Load only what we need. 5m candles power the size dist AND the
  // snapshot pipeline's prev-5m / MA-20 context, so they're needed if
  // either layer missed.
  const need5m = needSize || needSnapshotPass;
  const candles5m = need5m ? await loadTrainingCandles({ db, asset }) : null;
  const need1m = needSnapshotPass;
  const candles1m = need1m
    ? await loadTrainingCandles({ db, asset, timeframe: "1m" })
    : null;

  // Size distribution: from cache, or freshly computed.
  let distribution: AssetSizeDistribution | null;
  if (cachedSize !== null) {
    distribution = cachedSize;
  } else {
    if (candles5m === null) {
      throw new Error("unreachable: needed 5m candles but never loaded them");
    }
    distribution = computeCandleSizeDistribution({ asset, candles: candles5m });
    if (distribution !== null && cache !== null) {
      await cache.set({ manifest: sizeManifest, value: distribution });
    }
  }
  if (distribution === null) {
    return null;
  }

  // Survival + filters.
  let survival: AssetSurvivalDistribution | null = cachedSurvival;
  let perFilter: SurvivalFilterResultPayload[] | null =
    filterCacheState.length === 0
      ? null
      : filterCacheState.map((s) => s.cached as SurvivalFilterResultPayload);

  if (needSnapshotPass) {
    if (candles1m === null || candles5m === null) {
      throw new Error(
        "unreachable: needed snapshots but never loaded the source candles",
      );
    }
    // Run only the missing filters through the framework. The baseline
    // is produced by the same single sweep regardless of how many
    // filters we run, so we get cheap baseline data when the survival
    // layer also missed.
    const filtersToRun = missingFilters.map((s) => s.filter);
    const {
      baseline,
      baselineByYear,
      perFilter: freshPerFilter,
    } = applySurvivalFilters({
      snapshots: computeSurvivalSnapshots({
        candles1m,
        candles5m,
      }),
      filters: filtersToRun,
    });
    if (
      survivalManifest !== null &&
      cachedSurvival === null &&
      baseline.windowCount > 0
    ) {
      const fresh: AssetSurvivalDistribution = {
        asset,
        windowCount: baseline.windowCount,
        all: { byRemaining: baseline.byRemaining },
        byYear: baselineByYear,
      };
      survival = fresh;
      if (cache !== null) {
        await cache.set({ manifest: survivalManifest, value: fresh });
      }
    }
    if (perFilter === null) {
      perFilter = filterCacheState.map(
        (s) => s.cached as SurvivalFilterResultPayload,
      );
    }
    for (let i = 0; i < missingFilters.length; i += 1) {
      const slot = missingFilters[i];
      const fresh = freshPerFilter[i];
      if (slot === undefined || fresh === undefined) {
        continue;
      }
      const idx = filterCacheState.findIndex(
        (s) => s.filter.id === slot.filter.id,
      );
      if (idx < 0) {
        continue;
      }
      perFilter[idx] = fresh;
      if (cache !== null) {
        await cache.set({ manifest: slot.manifest, value: fresh });
      }
    }
  }

  // Overlay the live filter object's display metadata
  // (displayName, description, labels) on top of cached entries so
  // copy edits don't need a cache invalidation. The cached entry's
  // numerical surfaces are authoritative; only the labels swap in.
  if (perFilter !== null) {
    perFilter = perFilter.map((entry) => {
      const live = survivalFilters.find((f) => f.id === entry.id);
      if (live === undefined) {
        return entry;
      }
      return {
        ...entry,
        displayName: live.displayName,
        description: live.description,
        trueLabel: live.trueLabel,
        falseLabel: live.falseLabel,
      };
    });
  }

  const filterResults: AssetSurvivalFilters | null =
    perFilter === null ? null : { asset, results: perFilter };

  // Regime-algo pass. We re-walk the snapshot stream once for the
  // regime layer when any algo's cache missed; the survival/filter
  // layer above already had its own walk. Two passes total worst-case
  // (size, regime+filter+survival) is the simplest correctness story
  // and the cache amortizes everything after the first run.
  let perRegimeAlgo: RegimeAlgoResult[] | null =
    regimeAlgoCacheState.length === 0
      ? null
      : regimeAlgoCacheState.map((s) => s.cached as RegimeAlgoResult);

  if (needAnyRegimeAlgo) {
    if (candles1m === null || candles5m === null) {
      throw new Error(
        "unreachable: needed regime pass but never loaded the source candles",
      );
    }
    const algosToRun = missingRegimeAlgos.map((s) => s.algo);
    const { perAlgo: freshPerAlgo } = applyRegimeAlgos({
      snapshots: computeSurvivalSnapshots({ candles1m, candles5m }),
      algos: algosToRun,
    });
    if (perRegimeAlgo === null) {
      perRegimeAlgo = regimeAlgoCacheState.map(
        (s) => s.cached as RegimeAlgoResult,
      );
    }
    for (let i = 0; i < missingRegimeAlgos.length; i += 1) {
      const slot = missingRegimeAlgos[i];
      const fresh = freshPerAlgo[i];
      if (slot === undefined || fresh === undefined) {
        continue;
      }
      const idx = regimeAlgoCacheState.findIndex(
        (s) => s.algo.id === slot.algo.id,
      );
      if (idx < 0) {
        continue;
      }
      perRegimeAlgo[idx] = fresh;
      if (cache !== null) {
        await cache.set({ manifest: slot.manifest, value: fresh });
      }
    }
  }

  // Overlay live algo metadata on cached entries so copy edits don't
  // need a cache invalidation, mirroring the filter-overlay above.
  if (perRegimeAlgo !== null) {
    perRegimeAlgo = perRegimeAlgo.map((entry) => {
      const live = regimeAlgos.find((a) => a.id === entry.id);
      if (live === undefined) {
        return entry;
      }
      return {
        ...entry,
        displayName: live.displayName,
        description: live.description,
        params: live.params,
      };
    });
  }

  const regimeAlgoResults: AssetRegimeAlgos | null =
    perRegimeAlgo === null || perRegimeAlgo.length === 0
      ? null
      : { asset, results: perRegimeAlgo };

  return {
    distribution,
    survival,
    filterResults,
    regimeAlgoResults,
    cacheHits,
    cacheTotal,
  };
}

export function buildTrainingDistributionsPayload({
  distributions,
  survivalDistributions,
  survivalFilterResults,
  regimeAlgoResults,
}: {
  readonly distributions: readonly AssetSizeDistribution[];
  readonly survivalDistributions: readonly AssetSurvivalDistribution[];
  readonly survivalFilterResults: readonly AssetSurvivalFilters[];
  readonly regimeAlgoResults: readonly AssetRegimeAlgos[];
}): TrainingDistributionsPayload {
  return {
    command: "training:distributions",
    generatedAtMs: Date.now(),
    series: trainingCandleSeries,
    assets: distributions,
    survival: survivalDistributions,
    survivalFilters: survivalFilterResults,
    regimeAlgos: regimeAlgoResults,
  };
}
