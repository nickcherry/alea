import { mkdir } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineFlagOption } from "@alea/lib/cli/defineFlagOption";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { openHtmlOnDarwin } from "@alea/lib/exchangePrices/openHtmlOnDarwin";
import { loadReplayReportPayload } from "@alea/lib/trading/replay/report/loadReplayReportPayload";
import { writeReplayReportArtifacts } from "@alea/lib/trading/replay/report/writeReplayReportArtifacts";
import { formatPercent, formatUsd } from "@alea/lib/trading/format";
import pc from "picocolors";
import { z } from "zod";

const tmpDir = resolvePath(import.meta.dir, "../../../tmp");
const replayTradingDir = resolvePath(tmpDir, "replay-trading");

export const tradingReplayReportCommand = defineCommand({
  name: "trading:replay-report",
  summary: "Render a replay session dashboard",
  description:
    "Reads one replay JSONL session, defaulting to the newest tmp/replay-trading/replay-trading_*.jsonl file, and writes a standalone Alea-styled HTML dashboard plus JSON sidecar under tmp/. The report focuses on finalized queue-aware fills, filled-versus-placed counterfactuals, absolute placement-distance stats, per-asset/window breakdowns, and the virtual-order ledger.",
  options: [
    defineValueOption({
      key: "session",
      long: "--session",
      valueName: "PATH",
      schema: z
        .string()
        .optional()
        .describe(
          "Replay JSONL session to render. Defaults to the newest tmp/replay-trading/replay-trading_*.jsonl.",
        ),
    }),
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
    "bun alea trading:replay-report",
    "bun alea trading:replay-report --no-open",
    "bun alea trading:replay-report --session tmp/replay-trading/replay-trading_2026-05-04T23-50-46.294Z.jsonl",
  ],
  output:
    "Prints the chosen replay JSONL session, high-level canonical vs counterfactual metrics, and the HTML + JSON artifact paths.",
  sideEffects:
    "Reads a local replay JSONL file and writes one HTML and one JSON report artifact under alea/tmp/. Does not call network APIs and does not place or cancel orders.",
  async run({ io, options }) {
    const payload = await loadReplayReportPayload({
      sessionPath: options.session,
      replayTradingDir,
    });
    await mkdir(tmpDir, { recursive: true });
    const stamp = new Date(payload.generatedAtMs)
      .toISOString()
      .replace(/[:.]/g, "-");
    const htmlPath = resolvePath(tmpDir, `replay-trading-report_${stamp}.html`);
    const jsonPath = resolvePath(tmpDir, `replay-trading-report_${stamp}.json`);
    await writeReplayReportArtifacts({ payload, htmlPath, jsonPath });

    io.writeStdout(
      `${pc.bold("trading:replay-report")} ${pc.dim("session=")}${payload.sourcePath}\n\n` +
        `${pc.green("canonical pnl =")} ${formatUsd({ value: payload.summary.canonicalPnlUsd })}\n` +
        `  ${pc.dim("orders:")} ${payload.summary.finalizedOrderCount} finalized analyzed, ${payload.summary.pendingOrderCount} pending excluded\n` +
        `  ${pc.dim("canonical fills:")} ${payload.summary.canonicalFilledCount}/${payload.summary.finalizedOrderCount} (${formatPercent({ value: payload.summary.canonicalFillRate })})\n` +
        `  ${pc.dim("all-filled pnl:")} ${formatUsd({ value: payload.summary.allOrdersFilledPnlUsd })}\n` +
        `  ${pc.dim("actual - all-filled pnl:")} ${formatUsd({ value: payload.summary.fillSelectionDeltaUsd })}\n` +
        `${pc.green("wrote")} ${pc.dim(jsonPath)}\n` +
        `${pc.green("wrote")} ${pc.dim(htmlPath)}\n`,
    );

    if (!options.noOpen) {
      openHtmlOnDarwin({ path: htmlPath });
    }
  },
});

