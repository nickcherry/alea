import { mkdir } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { loadBacktestPayload } from "@alea/lib/backtest/dashboard/loadBacktestPayload";
import { writeBacktestArtifacts } from "@alea/lib/backtest/dashboard/writeBacktestArtifacts";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineFlagOption } from "@alea/lib/cli/defineFlagOption";
import { runWranglerDeploy } from "@alea/lib/dashboards/runWranglerDeploy";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import pc from "picocolors";
import { z } from "zod";

const repoRoot = resolvePath(import.meta.dir, "../../..");
const tmpDir = resolvePath(repoRoot, "tmp");
const webDir = resolvePath(tmpDir, "web");
const backtestDir = resolvePath(webDir, "backtest");

/**
 * Builds the backtest dashboard the alea Cloudflare worker serves and
 * lays it out under `tmp/web/`:
 *
 *   tmp/web/index.html               ← candidate backtests ("/")
 *   tmp/web/index.assets/            ← its frozen CSS+JS
 *   tmp/web/data.json                ← raw payload for the backtest page
 *   tmp/web/backtest/index.html      ← candidate backtests alias ("/backtest/")
 */
export const dashboardsBuildCommand = defineCommand({
  name: "dashboards:build",
  summary: "Build the backtest dashboard into tmp/web and optionally deploy",
  description:
    "Generates the candidate backtest dashboard (/ and /backtest/) under tmp/web in the routing layout the alea Cloudflare worker serves. With --deploy, runs `bunx wrangler deploy` after the build.",
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
    "Prints a build status line and, with --deploy, the deployed URL.",
  sideEffects:
    "Reads the backtest dashboard tables. Writes HTML + JSON + asset folders under tmp/web/. With --deploy, shells out to `bunx wrangler deploy`.",
  async run({ io, options }) {
    io.writeStdout(`${pc.bold("dashboards:build")}\n\n`);

    await mkdir(webDir, { recursive: true });
    await mkdir(backtestDir, { recursive: true });

    await buildBacktestDashboard({ io });

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

async function buildBacktestDashboard({
  io,
}: {
  readonly io: { writeStdout: (line: string) => void };
}): Promise<void> {
  io.writeStdout(`${pc.bold("backtest")} ${pc.dim("(/, /backtest/)")}\n`);

  const db = createDatabase();
  try {
    const payload = await loadBacktestPayload({ db });
    const rootHtmlPath = resolvePath(webDir, "index.html");
    const rootJsonPath = resolvePath(webDir, "data.json");
    const htmlPath = resolvePath(backtestDir, "index.html");
    const jsonPath = resolvePath(backtestDir, "data.json");
    await Promise.all([
      writeBacktestArtifacts({
        payload,
        htmlPath: rootHtmlPath,
        jsonPath: rootJsonPath,
      }),
      writeBacktestArtifacts({ payload, htmlPath, jsonPath }),
    ]);
    const rowCount = Object.values(payload.byPeriod).reduce(
      (sum, slice) =>
        sum +
        Object.values(slice.byAsset).reduce(
          (assetSum, assetSlice) => assetSum + assetSlice.rows.length,
          0,
        ),
      0,
    );
    io.writeStdout(
      `  ${pc.green("candidates =")} ${rowCount.toLocaleString()}\n` +
        `  ${pc.green("wrote")} ${pc.dim(rootHtmlPath)} ${pc.dim(`and ${htmlPath}`)}\n`,
    );
  } finally {
    await destroyDatabase(db);
  }
}
