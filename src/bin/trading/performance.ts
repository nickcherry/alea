import { mkdir } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { env } from "@alea/constants/env";
import { CliUsageError } from "@alea/lib/cli/CliUsageError";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineFlagOption } from "@alea/lib/cli/defineFlagOption";
import { openHtmlOnDarwin } from "@alea/lib/exchangePrices/openHtmlOnDarwin";
import { getPolymarketAuthState } from "@alea/lib/polymarket/getPolymarketClobClient";
import { formatUsd } from "@alea/lib/trading/format";
import { writeTradingPerformanceArtifacts } from "@alea/lib/trading/performance/writeTradingPerformanceArtifacts";
import { scanPolymarketTradingPerformance } from "@alea/lib/trading/vendor/polymarket/scanTradingPerformance";
import pc from "picocolors";
import { z } from "zod";

const tmpDir = resolvePath(import.meta.dir, "../../../tmp");

export const tradingPerformanceCommand = defineCommand({
  name: "trading:performance",
  summary: "Render a Polymarket trading performance dashboard",
  description:
    "Fetches every position the configured Polymarket funder/proxy holds (open or redeemable) via the public data-api /positions endpoint, builds the lifetime PnL summary from each position's mark-to-market cashPnl, and writes a standalone HTML dashboard plus JSON sidecar to alea/tmp/. Polymarket data-api is the only source.",
  options: [
    defineFlagOption({
      key: "noOpen",
      long: "--no-open",
      schema: z
        .boolean()
        .default(false)
        .describe("Skip auto-opening the HTML dashboard on macOS."),
    }),
  ],
  examples: [
    "bun alea trading:performance",
    "bun alea trading:performance --no-open",
  ],
  output:
    "Prints fetch progress, the lifetime PnL summary, and the paths of the HTML + JSON artifacts.",
  sideEffects:
    "Reads the public Polymarket data-api /positions endpoint. Writes one HTML and one JSON file to alea/tmp/. Does not use a database and does not place or cancel orders.",
  async run({ io, options }) {
    if (
      env.polymarketPrivateKey === undefined ||
      env.polymarketFunderAddress === undefined
    ) {
      throw new CliUsageError(
        "POLYMARKET_PRIVATE_KEY and POLYMARKET_FUNDER_ADDRESS must be set.",
      );
    }

    const auth = await getPolymarketAuthState();
    io.writeStdout(
      `${pc.bold("trading:performance")} ${pc.dim("funder=")}${auth.funderAddress.slice(0, 10)}...\n\n`,
    );

    const { payload } = await scanPolymarketTradingPerformance({
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

    await mkdir(tmpDir, { recursive: true });
    const stamp = new Date(payload.generatedAtMs)
      .toISOString()
      .replace(/[:.]/g, "-");
    const htmlPath = resolvePath(tmpDir, `trading-performance_${stamp}.html`);
    const jsonPath = resolvePath(tmpDir, `trading-performance_${stamp}.json`);
    await writeTradingPerformanceArtifacts({ payload, htmlPath, jsonPath });

    io.writeStdout(
      `\n${pc.green("lifetime pnl =")} ${formatUsd({ value: payload.summary.lifetimePnlUsd })}\n` +
        `  ${pc.dim("markets:")} ${payload.summary.marketCount}\n` +
        `  ${pc.dim("invested:")} ${formatUsd({ value: payload.summary.totalInvestedUsd, signed: false })}\n` +
        `  ${pc.dim("returned:")} ${formatUsd({ value: payload.summary.totalReturnedUsd, signed: false })}\n` +
        `  ${pc.dim("currently held:")} ${formatUsd({ value: payload.summary.currentValueUsd, signed: false })}\n` +
        `${pc.green("wrote")} ${pc.dim(jsonPath)}\n` +
        `${pc.green("wrote")} ${pc.dim(htmlPath)}\n`,
    );

    if (!options.noOpen) {
      openHtmlOnDarwin({ path: htmlPath });
    }
  },
});
