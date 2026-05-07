import { mkdir } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { assetValues } from "@alea/constants/assets";
import { trainingCandleSeries } from "@alea/constants/training";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineFlagOption } from "@alea/lib/cli/defineFlagOption";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import { openHtmlOnDarwin } from "@alea/lib/exchangePrices/openHtmlOnDarwin";
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
import { assetSchema } from "@alea/types/assets";
import pc from "picocolors";
import { z } from "zod";

const tmpDir = resolvePath(import.meta.dir, "../../../tmp");
const cacheDir = resolvePath(tmpDir, "cache/training-distributions");

/**
 * Computes the distribution of 5-minute candle body and wick sizes (each
 * expressed as a percentage of the bar's open price), the
 * point-of-no-return survival surface, and every binary filter overlay
 * for every requested asset in the local Postgres, then writes a paired
 * HTML dashboard and JSON sidecar to `alea/tmp/`.
 *
 * Heavy intermediate results are cached per asset under
 * `tmp/cache/training-distributions/`. Cache keys mix in the relevant
 * data freshness (max candle timestamp) and the algorithm/filter
 * versions, so re-runs with no changes are near-free, and adding a
 * single new filter recomputes only that filter.
 *
 * For the deployed multi-page worker layout, run `dashboards:build`
 * instead — it generates this dashboard plus the live trading PnL page
 * and pushes the whole site to Cloudflare.
 */
export const trainingDistributionsCommand = defineCommand({
  name: "training:distributions",
  summary: "Compute training distributions, survival surfaces, and filters",
  description:
    "Reads local Postgres for the configured training candle series (today: binance-perp 5m plus matching 1m snapshots) and computes body/wick distributions, the point-of-no-return survival surface, and every registered binary filter overlay. Writes an HTML dashboard focused on survival/filter analysis plus a JSON sidecar with the full raw payload.",
  options: [
    defineValueOption({
      key: "assets",
      long: "--assets",
      valueName: "LIST",
      schema: z
        .string()
        .optional()
        .transform((value) => parseList(value))
        .pipe(z.array(assetSchema).default([...assetValues]))
        .describe("Comma-separated asset list (default: all whitelisted)."),
    }),
    defineFlagOption({
      key: "noOpen",
      long: "--no-open",
      schema: z
        .boolean()
        .default(false)
        .describe("Skip auto-opening the HTML dashboard on macOS."),
    }),
    defineFlagOption({
      key: "noCache",
      long: "--no-cache",
      schema: z
        .boolean()
        .default(false)
        .describe(
          "Bypass the on-disk cache and recompute everything from scratch.",
        ),
    }),
  ],
  examples: [
    "bun alea training:distributions",
    "bun alea training:distributions --assets btc,eth",
    "bun alea training:distributions --no-open",
    "bun alea training:distributions --no-cache",
  ],
  output:
    "Prints per-asset row counts and the paths of the HTML + JSON artifacts.",
  sideEffects:
    "Reads the candles table; writes one HTML and one JSON file to alea/tmp/; reads/writes intermediate JSON in tmp/cache/.",
  async run({ io, options }) {
    io.writeStdout(
      `${pc.bold("training:distributions")}  ${pc.dim("series=")}${trainingCandleSeries.source}-${trainingCandleSeries.product}  ${pc.dim("timeframe=")}${trainingCandleSeries.timeframe}  ${pc.dim("assets=")}${options.assets.join(",")}${options.noCache ? `  ${pc.yellow("[no-cache]")}` : ""}\n\n`,
    );

    const db = createDatabase();
    const cache = options.noCache
      ? null
      : new TrainingCacheStore({ root: cacheDir });
    const distributions: AssetSizeDistribution[] = [];
    const survivalDistributions: AssetSurvivalDistribution[] = [];
    const survivalFilterResults: AssetSurvivalFilters[] = [];
    const regimeAlgoResults: AssetRegimeAlgos[] = [];

    try {
      for (const asset of options.assets) {
        const result = await processTrainingAsset({
          db,
          asset,
          cache,
        });
        if (result === null) {
          io.writeStdout(
            `${pc.bold(asset.toUpperCase().padEnd(5))} ${pc.yellow("no candles")}\n`,
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

        const yearKeys = Object.keys(result.distribution.byYear).sort();
        const survivalLabel =
          result.survival === null
            ? pc.yellow("no 1m")
            : `${pc.dim("windows=")}${result.survival.windowCount.toLocaleString()} ${pc.dim("filters=")}${survivalFilters.length} ${pc.dim("regimes=")}${regimeAlgos.length}`;
        const cacheLabel = formatCacheLabel({
          hits: result.cacheHits,
          total: result.cacheTotal,
        });
        io.writeStdout(
          `${pc.bold(asset.toUpperCase().padEnd(5))} ` +
            `${pc.dim("rows=")}${String(result.distribution.candleCount).padStart(8)} ` +
            `${pc.dim("years=")}${yearKeys.length > 0 ? yearKeys.join(",") : "—"} ` +
            `${survivalLabel} ` +
            `${cacheLabel}\n`,
        );
      }
    } finally {
      await destroyDatabase(db);
    }

    if (distributions.length === 0) {
      io.writeStdout(
        `\n${pc.yellow("no distributions computed; nothing written")}\n`,
      );
      return;
    }

    await mkdir(tmpDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const htmlPath = resolvePath(
      tmpDir,
      `training-distributions_${stamp}.html`,
    );
    const jsonPath = resolvePath(
      tmpDir,
      `training-distributions_${stamp}.json`,
    );

    const payload = buildTrainingDistributionsPayload({
      distributions,
      survivalDistributions,
      survivalFilterResults,
      regimeAlgoResults,
    });
    await writeTrainingDistributionsArtifacts({ payload, htmlPath, jsonPath });

    io.writeStdout(
      `\n${pc.green("wrote")} ${pc.dim(jsonPath)}\n${pc.green("wrote")} ${pc.dim(htmlPath)}\n`,
    );

    if (!options.noOpen) {
      openHtmlOnDarwin({ path: htmlPath });
    }
  },
});

function formatCacheLabel({
  hits,
  total,
}: {
  readonly hits: number;
  readonly total: number;
}): string {
  if (total === 0) {
    return "";
  }
  const ratio = `${hits}/${total}`;
  if (hits === total) {
    return `${pc.dim("cache=")}${pc.green(ratio)}`;
  }
  if (hits === 0) {
    return `${pc.dim("cache=")}${pc.yellow(ratio)}`;
  }
  return `${pc.dim("cache=")}${pc.cyan(ratio)}`;
}

function parseList(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parts = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parts.length > 0 ? parts : undefined;
}
