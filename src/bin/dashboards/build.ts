import { mkdir } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { assetValues } from "@alea/constants/assets";
import { env } from "@alea/constants/env";
import { trainingCandleSeries } from "@alea/constants/training";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineFlagOption } from "@alea/lib/cli/defineFlagOption";
import { runWranglerDeploy } from "@alea/lib/dashboards/runWranglerDeploy";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import { getPolymarketAuthState } from "@alea/lib/polymarket/getPolymarketClobClient";
import { formatUsd } from "@alea/lib/trading/format";
import { writeTradingPerformanceArtifacts } from "@alea/lib/trading/performance/writeTradingPerformanceArtifacts";
import { scanPolymarketTradingPerformance } from "@alea/lib/trading/vendor/polymarket/scanTradingPerformance";
import { TrainingCacheStore } from "@alea/lib/training/cache/cacheStore";
import { regimeAlgos } from "@alea/lib/training/regimeAlgos/registry";
import {
  buildTrainingDistributionsPayload,
  processTrainingAsset,
} from "@alea/lib/training/runTrainingDistributionsPipeline";
import { survivalFilters } from "@alea/lib/training/survivalFilters/registry";
import type {
  AssetRegimeAlgos,
  AssetSizeDistribution,
  AssetSurvivalDistribution,
  AssetSurvivalFilters,
} from "@alea/lib/training/types";
import { writeTrainingDistributionsArtifacts } from "@alea/lib/training/writeTrainingDistributionsArtifacts";
import pc from "picocolors";
import { z } from "zod";

const repoRoot = resolvePath(import.meta.dir, "../../..");
const tmpDir = resolvePath(repoRoot, "tmp");
const webDir = resolvePath(tmpDir, "web");
const trainingCacheDir = resolvePath(tmpDir, "cache/training-distributions");

/**
 * Builds every static dashboard the alea Cloudflare worker serves and
 * lays them out under `tmp/web/` in the routing shape Wrangler expects:
 *
 *   tmp/web/index.html         ← live trading PnL (the worker's "/")
 *   tmp/web/index.assets/      ← its frozen CSS+JS
 *   tmp/web/data.json          ← raw payload for the trading page
 *   tmp/web/training/index.html
 *   tmp/web/training/index.assets/
 *   tmp/web/training/data.json
 *
 * Each page also renders the shared top nav, so the deployed site feels
 * like one multi-page app even though every page is a self-contained
 * static HTML asset.
 *
 * The trading page needs Polymarket auth (POLYMARKET_PRIVATE_KEY +
 * POLYMARKET_FUNDER_ADDRESS); when those aren't set we skip it with a
 * warning rather than failing — local devs without trading creds can
 * still rebuild the training dashboard.
 */
export const dashboardsBuildCommand = defineCommand({
  name: "dashboards:build",
  summary: "Build every dashboard into tmp/web and optionally deploy",
  description:
    "Generates the live trading PnL dashboard and the training distributions dashboard under tmp/web in the routing layout the alea Cloudflare worker serves (trading at /, training at /training/). With --deploy, runs `bunx wrangler deploy` after the build. Skips the trading page when Polymarket auth env vars are missing.",
  options: [
    defineFlagOption({
      key: "deploy",
      long: "--deploy",
      schema: z
        .boolean()
        .default(false)
        .describe(
          "After the build, push tmp/web/ to the alea Cloudflare Worker via Wrangler.",
        ),
    }),
  ],
  examples: [
    "bun alea dashboards:build",
    "bun alea dashboards:build --deploy",
  ],
  output:
    "Prints a per-dashboard build status line and, with --deploy, the deployed URL.",
  sideEffects:
    "Reads the candles table and Polymarket CLOB. Writes HTML + JSON + asset folders under tmp/web/. With --deploy, shells out to `bunx wrangler deploy`.",
  async run({ io, options }) {
    io.writeStdout(`${pc.bold("dashboards:build")}\n\n`);

    await mkdir(webDir, { recursive: true });

    await buildTradingDashboard({ io });
    await buildTrainingDashboard({ io });

    if (options.deploy) {
      io.writeStdout(`\n${pc.bold("deploying")} ${pc.dim("to alea worker")}\n`);
      try {
        const { url } = await runWranglerDeploy({
          cwd: repoRoot,
          onLog: (line) => io.writeStdout(pc.dim("  wrangler ") + line + "\n"),
        });
        io.writeStdout(`${pc.green("deployed")} ${pc.dim(url)}\n`);
      } catch (err) {
        io.writeStdout(
          `${pc.red("deploy failed:")} ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  },
});

async function buildTradingDashboard({
  io,
}: {
  readonly io: { writeStdout: (line: string) => void };
}): Promise<void> {
  io.writeStdout(`${pc.bold("trading")} ${pc.dim("(/)")}\n`);

  if (
    env.polymarketPrivateKey === undefined ||
    env.polymarketFunderAddress === undefined
  ) {
    io.writeStdout(
      `  ${pc.yellow("skipped:")} POLYMARKET_PRIVATE_KEY and POLYMARKET_FUNDER_ADDRESS must be set.\n`,
    );
    return;
  }

  const auth = await getPolymarketAuthState();
  io.writeStdout(
    `  ${pc.dim("funder=")}${auth.funderAddress.slice(0, 10)}...\n`,
  );

  const payload = await scanPolymarketTradingPerformance({
    funderAddress: auth.funderAddress,
    onProgress: (event) => {
      const label =
        event.kind === "activity-page"
          ? `${pc.dim("activity fetched:")} ${event.activitiesSoFar}`
          : `${pc.dim("positions fetched:")} ${event.positionsSoFar}`;
      io.writeStdout(`  ${label}\n`);
    },
  });

  const htmlPath = resolvePath(webDir, "index.html");
  const jsonPath = resolvePath(webDir, "data.json");
  await writeTradingPerformanceArtifacts({ payload, htmlPath, jsonPath });

  io.writeStdout(
    `  ${pc.green("pnl =")} ${formatUsd({ value: payload.summary.lifetimePnlUsd })}` +
      `  ${pc.dim("markets=")}${payload.summary.marketCount}` +
      `  ${pc.dim("current=")}${formatUsd({ value: payload.summary.currentValueUsd })}\n` +
      `  ${pc.green("wrote")} ${pc.dim(htmlPath)}\n`,
  );
}

async function buildTrainingDashboard({
  io,
}: {
  readonly io: { writeStdout: (line: string) => void };
}): Promise<void> {
  io.writeStdout(`\n${pc.bold("training")} ${pc.dim("(/training/)")}\n`);
  io.writeStdout(
    `  ${pc.dim("series=")}${trainingCandleSeries.source}-${trainingCandleSeries.product} ${pc.dim("timeframe=")}${trainingCandleSeries.timeframe}\n`,
  );

  const db = createDatabase();
  const cache = new TrainingCacheStore({ root: trainingCacheDir });
  const distributions: AssetSizeDistribution[] = [];
  const survivalDistributions: AssetSurvivalDistribution[] = [];
  const survivalFilterResults: AssetSurvivalFilters[] = [];
  const regimeAlgoResults: AssetRegimeAlgos[] = [];

  try {
    for (const asset of assetValues) {
      const result = await processTrainingAsset({ db, asset, cache });
      if (result === null) {
        io.writeStdout(
          `  ${pc.bold(asset.toUpperCase().padEnd(5))} ${pc.yellow("no candles")}\n`,
        );
        continue;
      }
      distributions.push(result.distribution);
      if (result.survival !== null) {
        survivalDistributions.push(result.survival);
      }
      if (result.filterResults !== null) {
        survivalFilterResults.push(result.filterResults);
      }
      if (result.regimeAlgoResults !== null) {
        regimeAlgoResults.push(result.regimeAlgoResults);
      }
      const survivalLabel =
        result.survival === null
          ? pc.yellow("no 1m")
          : `${pc.dim("windows=")}${result.survival.windowCount.toLocaleString()} ${pc.dim("filters=")}${survivalFilters.length} ${pc.dim("regimes=")}${regimeAlgos.length}`;
      io.writeStdout(
        `  ${pc.bold(asset.toUpperCase().padEnd(5))} ` +
          `${pc.dim("rows=")}${String(result.distribution.candleCount).padStart(8)} ` +
          `${survivalLabel} ` +
          `${pc.dim("cache=")}${result.cacheHits}/${result.cacheTotal}\n`,
      );
    }
  } finally {
    await destroyDatabase(db);
  }

  if (distributions.length === 0) {
    io.writeStdout(
      `  ${pc.yellow("no distributions computed; nothing written")}\n`,
    );
    return;
  }

  const trainingWebDir = resolvePath(webDir, "training");
  await mkdir(trainingWebDir, { recursive: true });
  const htmlPath = resolvePath(trainingWebDir, "index.html");
  const jsonPath = resolvePath(trainingWebDir, "data.json");

  const payload = buildTrainingDistributionsPayload({
    distributions,
    survivalDistributions,
    survivalFilterResults,
    regimeAlgoResults,
  });
  await writeTrainingDistributionsArtifacts({ payload, htmlPath, jsonPath });

  io.writeStdout(`  ${pc.green("wrote")} ${pc.dim(htmlPath)}\n`);
}
