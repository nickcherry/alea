/**
 * Regenerates `src/lib/trading/probabilityTable/researchChallengerTables.generated.ts`
 * with fresh data from local Postgres. Loops over the four
 * (source, product) tuples the live consensus strategy reads, runs
 * the same pipeline `trading:gen-probability-table` runs (just
 * pointed at each tuple instead of the canonical training series),
 * and writes the assembled module.
 *
 * Backs up the existing file to a `.bak` sibling so you can revert
 * fast if the regenerated tables turn out to be worse.
 *
 * Run with: `bun scripts/regen-research-challenger-tables.ts`
 */

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { assetValues } from "@alea/constants/assets";
import {
  LIVE_TRADING_REGIME_ALGOS,
  MIN_BUCKET_SAMPLES,
} from "@alea/constants/trading";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import { computeAssetProbabilities } from "@alea/lib/trading/computeAssetProbabilities";
import type {
  AssetProbabilities,
  ProbabilityTable,
} from "@alea/lib/trading/types";
import { loadTrainingCandles } from "@alea/lib/training/loadTrainingCandles";
import type { CandleSeries } from "@alea/types/candleSeries";

const repoRoot = resolvePath(import.meta.dir, "..");
const generatedPath = resolvePath(
  repoRoot,
  "src/lib/trading/probabilityTable/researchChallengerTables.generated.ts",
);
const backupPath = `${generatedPath}.bak`;
const tmpDir = resolvePath(repoRoot, "tmp");

const TUPLES: readonly { source: CandleSeries["source"]; product: CandleSeries["product"]; name: string }[] = [
  { source: "binance", product: "perp", name: "binance/perp" },
  { source: "binance", product: "spot", name: "binance/spot" },
  { source: "coinbase", product: "perp", name: "coinbase/perp" },
  { source: "coinbase", product: "spot", name: "coinbase/spot" },
];

async function main() {
  // Backup the old file so we can revert fast if results regress.
  try {
    await copyFile(generatedPath, backupPath);
    console.log(`backed up ${generatedPath} → ${backupPath}`);
  } catch (err) {
    console.warn(`backup skipped: ${(err as Error).message}`);
  }

  const db = createDatabase();
  const namedTables: { name: string; table: ProbabilityTable }[] = [];
  try {
    for (const tuple of TUPLES) {
      console.log(`\n=== ${tuple.name} ===`);
      const perAsset: AssetProbabilities[] = [];
      let firstWindowMs = Number.POSITIVE_INFINITY;
      let lastWindowMs = 0;

      for (const asset of assetValues) {
        const candles1m = await loadTrainingCandles({
          db,
          asset,
          timeframe: "1m",
          source: tuple.source,
          product: tuple.product,
        });
        if (candles1m.length === 0) {
          console.log(`  ${asset.toUpperCase().padEnd(5)} no 1m candles`);
          continue;
        }
        const candles5m = await loadTrainingCandles({
          db,
          asset,
          timeframe: "5m",
          source: tuple.source,
          product: tuple.product,
        });
        const probabilities = computeAssetProbabilities({
          asset,
          candles1m,
          candles5m,
          minBucketSamples: MIN_BUCKET_SAMPLES,
          regimeAlgos: LIVE_TRADING_REGIME_ALGOS,
        });
        if (probabilities === null) {
          console.log(`  ${asset.toUpperCase().padEnd(5)} no probabilities`);
          continue;
        }
        perAsset.push(probabilities);
        const first = candles1m[0]?.timestamp.getTime() ?? 0;
        const last = candles1m[candles1m.length - 1]?.timestamp.getTime() ?? 0;
        if (first < firstWindowMs) firstWindowMs = first;
        if (last > lastWindowMs) lastWindowMs = last;
        const totalBuckets = probabilities.leadingTables.reduce(
          (sum, t) =>
            sum +
            Object.values(t.surface.byRemaining).reduce(
              (s, arr) => s + arr.length,
              0,
            ),
          0,
        );
        console.log(
          `  ${asset.toUpperCase().padEnd(5)} windows=${probabilities.windowCount.toString().padStart(7)} ` +
            `tables=${probabilities.leadingTables.length} buckets=${totalBuckets}`,
        );
      }

      if (perAsset.length === 0) {
        throw new Error(`No probabilities computed for ${tuple.name}`);
      }

      const table: ProbabilityTable = {
        command: "trading:gen-probability-table",
        schemaVersion: 1,
        generatedAtMs: Date.now(),
        series: {
          source: tuple.source,
          product: tuple.product,
          timeframe: "5m",
        },
        minBucketSamples: MIN_BUCKET_SAMPLES,
        trainingRangeMs: {
          firstWindowMs:
            firstWindowMs === Number.POSITIVE_INFINITY ? 0 : firstWindowMs,
          lastWindowMs,
        },
        assets: perAsset,
      };
      namedTables.push({ name: tuple.name, table });
    }
  } finally {
    await destroyDatabase(db);
  }

  await writeAssembledModule({ namedTables });
  console.log(`\nwrote ${generatedPath}`);

  // Sidecar JSON for traceability.
  await mkdir(tmpDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sidecar = resolvePath(tmpDir, `research-challenger-tables_${stamp}.json`);
  await writeFile(sidecar, JSON.stringify(namedTables, null, 2), "utf8");
  console.log(`wrote ${sidecar}`);
}

async function writeAssembledModule({
  namedTables,
}: {
  readonly namedTables: readonly { name: string; table: ProbabilityTable }[];
}): Promise<void> {
  const header = `// Generated by scripts/regen-research-challenger-tables.ts.
// Regenerate intentionally when the challenger training tables change.
import type { ProbabilityTable } from "@alea/lib/trading/types";

export type NamedProbabilityTable = {
  readonly name: string;
  readonly table: ProbabilityTable;
};

export const researchChallengerProbabilityTables: readonly NamedProbabilityTable[] =
`;
  const body = JSON.stringify(namedTables, null, 2);
  // The TS file uses `as const`-ish shape; JSON.stringify produces
  // valid TS that satisfies the readonly array of named tables.
  const text = `${header}${body};\n`;
  await writeFile(generatedPath, text, "utf8");
}

await main();
