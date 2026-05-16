import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { env } from "@alea/constants/env";
import { loadBacktestPayload } from "@alea/lib/backtest/dashboard/loadBacktestPayload";
import { writeBacktestArtifacts } from "@alea/lib/backtest/dashboard/writeBacktestArtifacts";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineFlagOption } from "@alea/lib/cli/defineFlagOption";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { runWranglerDeploy } from "@alea/lib/dashboards/runWranglerDeploy";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import { loadDryRunPayload } from "@alea/lib/dryRun/dashboard/loadDryRunPayload";
import { writeDryRunArtifacts } from "@alea/lib/dryRun/dashboard/writeDryRunArtifacts";
import { loadPricePathsPayload } from "@alea/lib/polymarket/dashboard/loadPricePathsPayload";
import { loadProxyAccuracyPayload } from "@alea/lib/polymarket/dashboard/loadProxyAccuracyPayload";
import { writePricePathsArtifacts } from "@alea/lib/polymarket/dashboard/writePricePathsArtifacts";
import { writeProxyAccuracyArtifacts } from "@alea/lib/polymarket/dashboard/writeProxyAccuracyArtifacts";
import { getPolymarketAuthState } from "@alea/lib/polymarket/getPolymarketClobClient";
import { formatUsd } from "@alea/lib/trading/format";
import { writeTradingPerformanceArtifacts } from "@alea/lib/trading/performance/writeTradingPerformanceArtifacts";
import {
  type PolymarketRawActivity,
  scanPolymarketTradingPerformance,
} from "@alea/lib/trading/vendor/polymarket/scanTradingPerformance";
import pc from "picocolors";
import { z } from "zod";

const repoRoot = resolvePath(import.meta.dir, "../../..");
const tmpDir = resolvePath(repoRoot, "tmp");
const webDir = resolvePath(tmpDir, "web");
const backtestDir = resolvePath(webDir, "backtest");
const dryRunDir = resolvePath(webDir, "dryrun");
const proxyDir = resolvePath(webDir, "proxy");
const pricePathsDir = resolvePath(webDir, "price-paths");
const cacheDir = resolvePath(tmpDir, ".cache");
const DASHBOARD_BUILD_CONCURRENCY = 4;

type DashboardBuildIo = { readonly writeStdout: (line: string) => void };

type DashboardPageBuild = {
  readonly name: string;
  readonly run: (io: DashboardBuildIo) => Promise<void>;
};

/**
 * Builds every static dashboard the alea Cloudflare worker serves
 * and lays them out under `tmp/web/` in the routing shape Wrangler
 * expects.
 *
 *   tmp/web/index.html               ← live trading PnL ("/")
 *   tmp/web/index.assets/            ← its frozen CSS+JS
 *   tmp/web/data.json                ← raw payload for the trading page
 *   tmp/web/backtest/index.html      ← candidate backtests ("/backtest/")
 *   tmp/web/dryrun/index.html       ← dry-run decisions ("/dryrun/")
 *   tmp/web/price-paths/index.html   ← price-path calibration ("/price-paths/")
 *   tmp/web/price-paths/index.assets/
 *   tmp/web/price-paths/data.json
 *   tmp/web/proxy/index.html         ← proxy accuracy ("/proxy/")
 *
 * Trading page needs Polymarket auth (POLYMARKET_PRIVATE_KEY +
 * POLYMARKET_FUNDER_ADDRESS); when those aren't set we skip it with
 * a warning rather than failing. The other pages read only local tables.
 */
export const dashboardsBuildCommand = defineCommand({
  name: "dashboards:build",
  summary: "Build every dashboard into tmp/web and optionally deploy",
  description:
    "Generates the live trading PnL dashboard (/), candidate backtest page (/backtest/), dry-run page (/dryrun/), price-path calibration page (/price-paths/), and proxy accuracy page (/proxy/) under tmp/web in the routing layout the alea Cloudflare worker serves. With --deploy, runs `bunx wrangler deploy` after the build. Skips the trading page when Polymarket auth env vars are missing.",
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
    defineFlagOption({
      key: "noCache",
      long: "--no-cache",
      schema: z
        .boolean()
        .default(false)
        .describe(
          "Force a full re-fetch of upstream APIs instead of reusing the local activity cache. By default the trading page re-uses cached Polymarket /activity rows and only fetches pages newer than the cache cutoff.",
        ),
    }),
    defineValueOption({
      key: "only",
      long: "--only",
      valueName: "LIST",
      schema: z
        .string()
        .optional()
        .transform((value) =>
          value === undefined
            ? null
            : new Set(
                value
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0),
              ),
        )
        .describe(
          "Comma-separated subset of pages to build (skip the rest). Names: trading, backtest, dryrun, price-paths, proxy.",
        ),
    }),
  ],
  examples: [
    "bun alea dashboards:build",
    "bun alea dashboards:build --deploy",
    "bun alea dashboards:build --only proxy --deploy",
  ],
  output:
    "Prints a per-dashboard build status line and, with --deploy, the deployed URL.",
  sideEffects:
    "Reads the Polymarket CLOB plus dashboard tables including `polymarket_price_samples` and `polymarket_resolutions`. Writes HTML + JSON + asset folders under tmp/web/. With --deploy, shells out to `bunx wrangler deploy`.",
  async run({ io, options }) {
    io.writeStdout(`${pc.bold("dashboards:build")}\n\n`);

    await mkdir(webDir, { recursive: true });
    await mkdir(backtestDir, { recursive: true });
    await mkdir(dryRunDir, { recursive: true });
    await mkdir(proxyDir, { recursive: true });
    await mkdir(pricePathsDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });

    const only = options.only;
    const useCache = !options.noCache;
    const shouldBuild = (name: string): boolean =>
      only === null ? true : only.has(name);

    const pageBuilds: DashboardPageBuild[] = [
      {
        name: "trading",
        run: (pageIo: DashboardBuildIo) =>
          buildTradingDashboard({ io: pageIo, useCache }),
      },
      {
        name: "price-paths",
        run: (pageIo: DashboardBuildIo) =>
          buildPricePathsDashboard({ io: pageIo }),
      },
      {
        name: "backtest",
        run: (pageIo: DashboardBuildIo) =>
          buildBacktestDashboard({ io: pageIo }),
      },
      {
        name: "dryrun",
        run: (pageIo: DashboardBuildIo) => buildDryRunDashboard({ io: pageIo }),
      },
      {
        name: "proxy",
        run: (pageIo: DashboardBuildIo) =>
          buildProxyAccuracyDashboard({ io: pageIo }),
      },
    ].filter((page) => shouldBuild(page.name));

    const pageError = await runPageBuilds({ io, pageBuilds });

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

    // Surface page failures last so a broken page doesn't block the deploy
    // of the other pages that did build. The cron wrapper relies on this:
    // proxy might be temporarily wedged on a migration, but trading and
    // price-paths should still roll out every minute.
    if (pageError !== null) {
      const message =
        pageError.error instanceof Error
          ? pageError.error.message
          : String(pageError.error);
      throw new Error(
        `dashboard page ${pageError.pageName} failed: ${message}`,
      );
    }
  },
});

async function runPageBuilds({
  io,
  pageBuilds,
}: {
  readonly io: { writeStdout: (line: string) => void };
  readonly pageBuilds: readonly DashboardPageBuild[];
}): Promise<{ readonly pageName: string; readonly error: unknown } | null> {
  const results = new Map<
    string,
    { readonly output: string; readonly error?: unknown }
  >();
  let nextIndex = 0;

  const workerCount = Math.min(DASHBOARD_BUILD_CONCURRENCY, pageBuilds.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const page = pageBuilds[nextIndex];
        nextIndex += 1;
        if (page === undefined) {
          return;
        }

        let output = "";
        const pageIo = {
          writeStdout: (line: string) => {
            output += line;
          },
        };

        try {
          await page.run(pageIo);
          results.set(page.name, { output });
        } catch (error) {
          results.set(page.name, { output, error });
        }
      }
    }),
  );

  let firstError: {
    readonly pageName: string;
    readonly error: unknown;
  } | null = null;
  for (const page of pageBuilds) {
    const result = results.get(page.name);
    if (result === undefined) {
      continue;
    }
    io.writeStdout(result.output);
    io.writeStdout("\n");
    if (result.error !== undefined && firstError === null) {
      firstError = { pageName: page.name, error: result.error };
    }
  }

  return firstError;
}

async function buildTradingDashboard({
  io,
  useCache,
}: {
  readonly io: { writeStdout: (line: string) => void };
  readonly useCache: boolean;
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

  const activityCachePath = resolvePath(
    cacheDir,
    `polymarket-activity-${auth.funderAddress.toLowerCase()}.json`,
  );
  const existingActivity = useCache
    ? await readActivityCache({ path: activityCachePath, io })
    : undefined;

  const { payload, mergedActivity } = await scanPolymarketTradingPerformance({
    funderAddress: auth.funderAddress,
    clobClient: auth.client,
    existingActivity,
    onProgress: (event) => {
      const label =
        event.kind === "activity-page"
          ? `${pc.dim("activity fetched:")} ${event.activitiesSoFar}`
          : event.kind === "positions-page"
            ? `${pc.dim("positions fetched:")} ${event.positionsSoFar}`
            : `${pc.dim("trades fetched:")} ${event.tradesSoFar}`;
      io.writeStdout(`  ${label}\n`);
    },
  });

  if (useCache) {
    await writeFile(activityCachePath, JSON.stringify(mergedActivity));
    const newCount =
      existingActivity === undefined
        ? mergedActivity.length
        : Math.max(0, mergedActivity.length - existingActivity.length);
    io.writeStdout(
      `  ${pc.dim("cache:")} ${mergedActivity.length.toLocaleString()} activity rows ` +
        `(${newCount.toLocaleString()} new this run)\n`,
    );
  }

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

async function buildDryRunDashboard({
  io,
}: {
  readonly io: { writeStdout: (line: string) => void };
}): Promise<void> {
  io.writeStdout(`${pc.bold("dry run")} ${pc.dim("(/dryrun/)")}\n`);

  const db = createDatabase();
  try {
    const payload = await loadDryRunPayload({ db });
    const htmlPath = resolvePath(dryRunDir, "index.html");
    const jsonPath = resolvePath(dryRunDir, "data.json");
    await writeDryRunArtifacts({ payload, htmlPath, jsonPath });
    const decisionCount = Object.values(payload.byPeriod).reduce(
      (sum, slice) => sum + slice.summary.totalDecisions,
      0,
    );
    io.writeStdout(
      `  ${pc.green("decisions =")} ${decisionCount.toLocaleString()}\n` +
        `  ${pc.green("wrote")} ${pc.dim(htmlPath)}\n`,
    );
  } finally {
    await destroyDatabase(db);
  }
}

async function buildBacktestDashboard({
  io,
}: {
  readonly io: { writeStdout: (line: string) => void };
}): Promise<void> {
  io.writeStdout(`${pc.bold("backtest")} ${pc.dim("(/backtest/)")}\n`);

  const db = createDatabase();
  try {
    const payload = await loadBacktestPayload({ db });
    const htmlPath = resolvePath(backtestDir, "index.html");
    const jsonPath = resolvePath(backtestDir, "data.json");
    await writeBacktestArtifacts({ payload, htmlPath, jsonPath });
    const rowCount = Object.values(payload.byPeriod).reduce(
      (sum, slice) => sum + slice.rows.length,
      0,
    );
    io.writeStdout(
      `  ${pc.green("candidates =")} ${rowCount.toLocaleString()}\n` +
        `  ${pc.green("wrote")} ${pc.dim(htmlPath)}\n`,
    );
  } finally {
    await destroyDatabase(db);
  }
}

async function buildPricePathsDashboard({
  io,
}: {
  readonly io: { writeStdout: (line: string) => void };
}): Promise<void> {
  io.writeStdout(`${pc.bold("price paths")} ${pc.dim("(/price-paths/)")}\n`);

  const db = createDatabase();
  try {
    const payload = await loadPricePathsPayload({ db, cacheDir });
    const htmlPath = resolvePath(pricePathsDir, "index.html");
    const jsonPath = resolvePath(pricePathsDir, "data.json");
    await writePricePathsArtifacts({ payload, htmlPath, jsonPath });
    const firstWindow =
      payload.firstWindowMs === null
        ? "none"
        : new Date(payload.firstWindowMs).toISOString().slice(0, 10);
    io.writeStdout(
      `  ${pc.green("samples =")} ${payload.sampleCount.toLocaleString()}` +
        `  ${pc.dim("windows=")}${payload.windowCount.toLocaleString()}` +
        `  ${pc.dim("lookback=")}${payload.lookbackDays}d` +
        `  ${pc.dim("first=")}${firstWindow}\n` +
        `  ${pc.green("wrote")} ${pc.dim(htmlPath)}\n`,
    );
  } finally {
    await destroyDatabase(db);
  }
}

async function buildProxyAccuracyDashboard({
  io,
}: {
  readonly io: { writeStdout: (line: string) => void };
}): Promise<void> {
  io.writeStdout(`${pc.bold("proxy accuracy")} ${pc.dim("(/proxy/)")}\n`);

  const db = createDatabase();
  try {
    const payload = await loadProxyAccuracyPayload({ db });
    if (payload.coverage.polymarketRows === 0) {
      io.writeStdout(
        `  ${pc.yellow("skipped:")} no rows in polymarket_resolutions — run \`bun alea polymarket:resolutions-sync\` first.\n`,
      );
      return;
    }
    const htmlPath = resolvePath(proxyDir, "index.html");
    const jsonPath = resolvePath(proxyDir, "data.json");
    await writeProxyAccuracyArtifacts({ payload, htmlPath, jsonPath });
    const summaryLines = payload.breakdowns
      .map((b) => {
        const rate =
          b.aggregate.agreementRate === null
            ? "—"
            : `${(b.aggregate.agreementRate * 100).toFixed(2)}%`;
        return `${b.timeframe}=${rate}(${b.aggregate.total.toLocaleString()})`;
      })
      .join("  ");
    io.writeStdout(
      `  ${pc.green("joined =")} ${payload.coverage.joinedRows.toLocaleString()}` +
        `  ${pc.dim("poly=")}${payload.coverage.polymarketRows.toLocaleString()}` +
        `  ${pc.dim("void=")}${payload.coverage.voidRows.toLocaleString()}` +
        `  ${pc.dim(summaryLines)}\n` +
        `  ${pc.green("wrote")} ${pc.dim(htmlPath)}\n`,
    );
  } finally {
    await destroyDatabase(db);
  }
}

async function readActivityCache({
  path,
  io,
}: {
  readonly path: string;
  readonly io: { writeStdout: (line: string) => void };
}): Promise<readonly PolymarketRawActivity[] | undefined> {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8"));
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as readonly PolymarketRawActivity[];
  } catch (err) {
    io.writeStdout(
      `  ${pc.yellow("cache:")} failed to read ${pc.dim(path)} (${err instanceof Error ? err.message : String(err)}) — refetching\n`,
    );
    return undefined;
  }
}
