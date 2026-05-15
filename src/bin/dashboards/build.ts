import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { env } from "@alea/constants/env";
import { loadBacktestPayload } from "@alea/lib/backtest/dashboard/loadBacktestPayload";
import { writeBacktestArtifacts } from "@alea/lib/backtest/dashboard/writeBacktestArtifacts";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineFlagOption } from "@alea/lib/cli/defineFlagOption";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { loadTradeCommitteePayload } from "@alea/lib/committee/dashboard/loadTradeCommitteePayload";
import { writeTradeCommitteeArtifacts } from "@alea/lib/committee/dashboard/writeTradeCommitteeArtifacts";
import { runWranglerDeploy } from "@alea/lib/dashboards/runWranglerDeploy";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import { loadDryRunPayload } from "@alea/lib/dryRun/dashboard/loadDryRunPayload";
import { writeDryRunArtifacts } from "@alea/lib/dryRun/dashboard/writeDryRunArtifacts";
import { loadExplorationPayload } from "@alea/lib/exploration/loadExplorationPayload";
import { writeExplorationArtifacts } from "@alea/lib/exploration/writeExplorationArtifacts";
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
const explorationDir = resolvePath(webDir, "exploration");
const committeeDir = resolvePath(webDir, "committee");
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
 *   tmp/web/price-paths/index.html   ← price-path calibration ("/price-paths/")
 *   tmp/web/price-paths/index.assets/
 *   tmp/web/price-paths/data.json
 *   tmp/web/exploration/index.html   ← filter exploration ("/exploration/")
 *   tmp/web/exploration/index.assets/
 *   tmp/web/exploration/data.json
 *   tmp/web/committee/index.html     ← trade committee ("/committee/")
 *   tmp/web/committee/index.assets/
 *   tmp/web/committee/data.json
 *   tmp/web/backtest/index.html      ← committee backtest ("/backtest/")
 *   tmp/web/backtest/index.assets/
 *   tmp/web/backtest/data.json
 *
 * Trading page needs Polymarket auth (POLYMARKET_PRIVATE_KEY +
 * POLYMARKET_FUNDER_ADDRESS); when those aren't set we skip it with
 * a warning rather than failing. The research/runtime pages read only
 * local dashboard tables, so they do not need trading credentials.
 */
export const dashboardsBuildCommand = defineCommand({
  name: "dashboards:build",
  summary: "Build every dashboard into tmp/web and optionally deploy",
  description:
    "Generates the live trading PnL dashboard (/), price-path calibration page (/price-paths/), filter exploration page (/exploration/), trade committee page (/committee/), backtest page (/backtest/), and dry-run page (/dryrun/) under tmp/web in the routing layout the alea Cloudflare worker serves. With --deploy, runs `bunx wrangler deploy` after the build. Skips the trading page when Polymarket auth env vars are missing.",
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
          "Comma-separated subset of pages to build (skip the rest). Names: trading, price-paths, exploration, committee, backtest, dryrun, proxy.",
        ),
    }),
  ],
  examples: [
    "bun alea dashboards:build",
    "bun alea dashboards:build --deploy",
    "bun alea dashboards:build --only committee --deploy",
  ],
  output:
    "Prints a per-dashboard build status line and, with --deploy, the deployed URL.",
  sideEffects:
    "Reads the Polymarket CLOB plus dashboard tables including `polymarket_price_samples`, `filter_runs`, `committee_selections`, `committee_backtest_runs`, and `dry_run_decisions`. Writes HTML + JSON + asset folders under tmp/web/. With --deploy, shells out to `bunx wrangler deploy`.",
  async run({ io, options }) {
    io.writeStdout(`${pc.bold("dashboards:build")}\n\n`);

    await mkdir(webDir, { recursive: true });
    await mkdir(explorationDir, { recursive: true });
    await mkdir(committeeDir, { recursive: true });
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
        name: "exploration",
        run: (pageIo: DashboardBuildIo) =>
          buildExplorationDashboard({ io: pageIo }),
      },
      {
        name: "committee",
        run: (pageIo: DashboardBuildIo) =>
          buildTradeCommitteeDashboard({ io: pageIo }),
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

    await runPageBuilds({ io, pageBuilds });

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

async function runPageBuilds({
  io,
  pageBuilds,
}: {
  readonly io: { writeStdout: (line: string) => void };
  readonly pageBuilds: readonly DashboardPageBuild[];
}): Promise<void> {
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

  if (firstError !== null) {
    const message =
      firstError.error instanceof Error
        ? firstError.error.message
        : String(firstError.error);
    throw new Error(`dashboard page ${firstError.pageName} failed: ${message}`);
  }
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

async function buildExplorationDashboard({
  io,
}: {
  readonly io: { writeStdout: (line: string) => void };
}): Promise<void> {
  io.writeStdout(`${pc.bold("exploration")} ${pc.dim("(/exploration/)")}\n`);

  const db = createDatabase();
  try {
    const payload = await loadExplorationPayload({ db });
    const htmlPath = resolvePath(explorationDir, "index.html");
    const jsonPath = resolvePath(explorationDir, "data.json");
    await writeExplorationArtifacts({ payload, htmlPath, jsonPath });
    if (payload.rows.length === 0) {
      io.writeStdout(
        `  ${pc.yellow("empty:")} no rows in filter_runs for the active training profile\n` +
          `  ${pc.green("wrote")} ${pc.dim(htmlPath)}\n`,
      );
      return;
    }
    const totalEngagements = payload.rows.reduce(
      (s, r) => s + r.nEngagements,
      0,
    );
    const topRow = payload.rows[0];
    const topLabel =
      topRow === undefined || topRow.winRate === null
        ? "—"
        : `${(topRow.winRate * 100).toFixed(1)}% ${topRow.filterId} ${topRow.period}`;
    io.writeStdout(
      `  ${pc.green("candidates =")} ${payload.rowCount.toLocaleString()}` +
        `  ${pc.dim("engagements=")}${totalEngagements.toLocaleString()}` +
        `  ${pc.dim("top=")}${topLabel}\n` +
        `  ${pc.green("wrote")} ${pc.dim(htmlPath)}\n`,
    );
  } finally {
    await destroyDatabase(db);
  }
}

async function buildTradeCommitteeDashboard({
  io,
}: {
  readonly io: { writeStdout: (line: string) => void };
}): Promise<void> {
  io.writeStdout(`${pc.bold("trade committee")} ${pc.dim("(/committee/)")}\n`);

  const db = createDatabase();
  try {
    const payload = await loadTradeCommitteePayload({ db });
    const htmlPath = resolvePath(committeeDir, "index.html");
    const jsonPath = resolvePath(committeeDir, "data.json");
    await writeTradeCommitteeArtifacts({ payload, htmlPath, jsonPath });
    const selectedAt =
      payload.selectedAtMs === null
        ? "none"
        : new Date(payload.selectedAtMs).toISOString().slice(0, 16);
    io.writeStdout(
      `  ${pc.green("candidates =")} ${payload.rowCount.toLocaleString()}` +
        `  ${pc.dim("filters=")}${payload.uniqueFilterCount.toLocaleString()}` +
        `  ${pc.dim("selected_at=")}${selectedAt}\n` +
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
    const latest = payload.latestRun;
    if (latest === null) {
      io.writeStdout(
        `  ${pc.yellow("no persisted committee backtest run")}\n` +
          `  ${pc.green("wrote")} ${pc.dim(htmlPath)}\n`,
      );
      return;
    }
    const wr =
      latest.totals.winRate === null
        ? "-"
        : `${(latest.totals.winRate * 100).toFixed(1)}%`;
    io.writeStdout(
      `  ${pc.green("run =")} ${latest.id}` +
        `  ${pc.dim("decisions=")}${latest.totals.committeeDecisions.toLocaleString()}` +
        `  ${pc.dim("scored=")}${latest.totals.scoredTrades.toLocaleString()}` +
        `  ${pc.dim("stake=")}$${latest.stakeUsd.toLocaleString()}` +
        `  ${pc.dim("wr=")}${wr}` +
        `  ${pc.dim("pnl=")}$${latest.totals.pnlUsd.toLocaleString()}` +
        "\n" +
        `  ${pc.green("wrote")} ${pc.dim(htmlPath)}\n`,
    );
  } finally {
    await destroyDatabase(db);
  }
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
    const s = payload.byPeriod[payload.decisionConfig.period]?.summary;
    const wr =
      s === undefined || s.winRate === null
        ? "—"
        : `${(s.winRate * 100).toFixed(1)}%`;
    const totalDecisions = s?.totalDecisions ?? 0;
    const settled = s?.settledDecisions ?? 0;
    const pending = s?.pendingDecisions ?? 0;
    io.writeStdout(
      `  ${pc.green("decisions =")} ${totalDecisions.toLocaleString()}` +
        `  ${pc.dim("settled=")}${settled.toLocaleString()}` +
        `  ${pc.dim("pending=")}${pending.toLocaleString()}` +
        `  ${pc.dim("wr=")}${wr}` +
        `  ${pc.dim("period=")}${payload.decisionConfig.period}\n` +
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
