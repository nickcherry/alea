import { mkdir } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { env } from "@alea/constants/env";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineFlagOption } from "@alea/lib/cli/defineFlagOption";
import { loadTradeCommitteePayload } from "@alea/lib/committee/dashboard/loadTradeCommitteePayload";
import { writeTradeCommitteeArtifacts } from "@alea/lib/committee/dashboard/writeTradeCommitteeArtifacts";
import { runWranglerDeploy } from "@alea/lib/dashboards/runWranglerDeploy";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import { loadDryRunPayload } from "@alea/lib/dryRun/dashboard/loadDryRunPayload";
import { writeDryRunArtifacts } from "@alea/lib/dryRun/dashboard/writeDryRunArtifacts";
import { loadExplorationPayload } from "@alea/lib/exploration/loadExplorationPayload";
import { writeExplorationArtifacts } from "@alea/lib/exploration/writeExplorationArtifacts";
import { loadProxyAccuracyPayload } from "@alea/lib/polymarket/dashboard/loadProxyAccuracyPayload";
import { writeProxyAccuracyArtifacts } from "@alea/lib/polymarket/dashboard/writeProxyAccuracyArtifacts";
import { getPolymarketAuthState } from "@alea/lib/polymarket/getPolymarketClobClient";
import { formatUsd } from "@alea/lib/trading/format";
import { writeTradingPerformanceArtifacts } from "@alea/lib/trading/performance/writeTradingPerformanceArtifacts";
import { scanPolymarketTradingPerformance } from "@alea/lib/trading/vendor/polymarket/scanTradingPerformance";
import pc from "picocolors";
import { z } from "zod";

const repoRoot = resolvePath(import.meta.dir, "../../..");
const tmpDir = resolvePath(repoRoot, "tmp");
const webDir = resolvePath(tmpDir, "web");
const explorationDir = resolvePath(webDir, "exploration");
const committeeDir = resolvePath(webDir, "committee");
const dryRunDir = resolvePath(webDir, "dryrun");
const proxyDir = resolvePath(webDir, "proxy");

/**
 * Builds every static dashboard the alea Cloudflare worker serves
 * and lays them out under `tmp/web/` in the routing shape Wrangler
 * expects.
 *
 *   tmp/web/index.html               ← live trading PnL ("/")
 *   tmp/web/index.assets/            ← its frozen CSS+JS
 *   tmp/web/data.json                ← raw payload for the trading page
 *   tmp/web/exploration/index.html   ← filter exploration ("/exploration/")
 *   tmp/web/exploration/index.assets/
 *   tmp/web/exploration/data.json
 *   tmp/web/committee/index.html     ← trade committee ("/committee/")
 *   tmp/web/committee/index.assets/
 *   tmp/web/committee/data.json
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
    "Generates the live trading PnL dashboard (/), filter exploration page (/exploration/), trade committee page (/committee/), and dry-run page (/dryrun/) under tmp/web in the routing layout the alea Cloudflare worker serves. With --deploy, runs `bunx wrangler deploy` after the build. Skips the trading page when Polymarket auth env vars are missing.",
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
  examples: ["bun alea dashboards:build", "bun alea dashboards:build --deploy"],
  output:
    "Prints a per-dashboard build status line and, with --deploy, the deployed URL.",
  sideEffects:
    "Reads the Polymarket CLOB plus dashboard tables including `filter_runs`, `committee_selections`, and `dry_run_decisions`. Writes HTML + JSON + asset folders under tmp/web/. With --deploy, shells out to `bunx wrangler deploy`.",
  async run({ io, options }) {
    io.writeStdout(`${pc.bold("dashboards:build")}\n\n`);

    await mkdir(webDir, { recursive: true });
    await mkdir(explorationDir, { recursive: true });
    await mkdir(committeeDir, { recursive: true });
    await mkdir(dryRunDir, { recursive: true });
    await mkdir(proxyDir, { recursive: true });

    await buildTradingDashboard({ io });
    io.writeStdout("\n");
    await buildExplorationDashboard({ io });
    io.writeStdout("\n");
    await buildTradeCommitteeDashboard({ io });
    io.writeStdout("\n");
    await buildDryRunDashboard({ io });
    io.writeStdout("\n");
    await buildProxyAccuracyDashboard({ io });

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
    clobClient: auth.client,
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

async function buildExplorationDashboard({
  io,
}: {
  readonly io: { writeStdout: (line: string) => void };
}): Promise<void> {
  io.writeStdout(`${pc.bold("exploration")} ${pc.dim("(/exploration/)")}\n`);

  const db = createDatabase();
  try {
    const payload = await loadExplorationPayload({ db });
    if (payload.rows.length === 0) {
      io.writeStdout(
        `  ${pc.yellow("skipped:")} no rows in filter_runs — run \`bun alea backtest:run\` first.\n`,
      );
      return;
    }
    const htmlPath = resolvePath(explorationDir, "index.html");
    const jsonPath = resolvePath(explorationDir, "data.json");
    await writeExplorationArtifacts({ payload, htmlPath, jsonPath });
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
        `  ${pc.dim("buckets=")}${payload.activeBucketCount}/8` +
        `  ${pc.dim("selected_at=")}${selectedAt}\n` +
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
    const s = payload.summary;
    const wr = s.winRate === null ? "—" : `${(s.winRate * 100).toFixed(1)}%`;
    io.writeStdout(
      `  ${pc.green("decisions =")} ${s.totalDecisions.toLocaleString()}` +
        `  ${pc.dim("settled=")}${s.settledDecisions.toLocaleString()}` +
        `  ${pc.dim("pending=")}${s.pendingDecisions.toLocaleString()}` +
        `  ${pc.dim("wr=")}${wr}\n` +
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
