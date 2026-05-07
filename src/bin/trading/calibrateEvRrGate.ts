import { resolve as resolvePath } from "node:path";

import { CliUsageError } from "@alea/lib/cli/CliUsageError";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { formatPercent, formatUsd } from "@alea/lib/trading/format";
import {
  type CalibrationCellStats,
  type CalibrationOrder,
  type CalibrationResult,
  calibrateEvRrGate,
  DEFAULT_MIN_EV_GRID,
  DEFAULT_MIN_RR_GRID,
  POLYMARKET_TAKER_FEE_RATE,
} from "@alea/lib/trading/replay/calibration/calibrateEvRrGate";
import {
  loadCalibrationOrdersFromFile,
  type SessionConfigSummary,
} from "@alea/lib/trading/replay/calibration/loadCalibrationOrders";
import { findLatestReplaySession } from "@alea/lib/trading/replay/report/loadReplayReportPayload";
import pc from "picocolors";
import { z } from "zod";

const tmpDir = resolvePath(import.meta.dir, "../../../tmp");
const replayTradingDir = resolvePath(tmpDir, "replay-trading");

/**
 * Post-hoc sweep of the dollar-EV / reward-risk gate parameters
 * over an existing replay JSONL session. Re-derives each order's
 * taker economics from the session's `takerCounterfactual` block,
 * applies (`MIN_EV` × `MIN_RR`) thresholds across a configurable
 * grid, and reports PnL / trade-count / win-rate heatmaps so the
 * operator can pick a sane operating point.
 *
 * No re-runs needed — the heavy work (replay against captured
 * `market_event` data) already happened to produce the JSONL. This
 * command just classifies which orders the new gate would have
 * kept and what their realised PnL was.
 *
 * Reuses `computeTradeEconomics` so the math matches the live
 * evaluator exactly. Default fee assumption is Polymarket's
 * empirical 700 bps taker fee.
 */
export const tradingCalibrateEvRrGateCommand = defineCommand({
  name: "trading:calibrate-ev-rr-gate",
  summary:
    "Sweep the EV / reward-risk gate over a replay session and print heatmaps",
  description:
    "Reads one trading:replay JSONL session (default: newest under tmp/replay-trading/), re-derives each order's taker economics from the stored takerCounterfactual, and sweeps a grid of (MIN_EV, MIN_RR) thresholds to surface the joint PnL maximum. Read-only — no postgres or network access.",
  options: [
    defineValueOption({
      key: "session",
      long: "--session",
      valueName: "PATH",
      schema: z
        .string()
        .optional()
        .describe(
          "Replay JSONL session to sweep. Defaults to the newest tmp/replay-trading/replay-trading_*.jsonl.",
        ),
    }),
    defineValueOption({
      key: "evGrid",
      long: "--ev-grid",
      valueName: "CSV",
      schema: z
        .string()
        .optional()
        .transform((value) => parseNumericList(value))
        .pipe(z.array(z.number()).default([...DEFAULT_MIN_EV_GRID]))
        .describe(
          `Comma-separated MIN_EV values (default: ${DEFAULT_MIN_EV_GRID.join(",")}).`,
        ),
    }),
    defineValueOption({
      key: "rrGrid",
      long: "--rr-grid",
      valueName: "CSV",
      schema: z
        .string()
        .optional()
        .transform((value) => parseNumericList(value))
        .pipe(z.array(z.number()).default([...DEFAULT_MIN_RR_GRID]))
        .describe(
          `Comma-separated MIN_RR values (default: ${DEFAULT_MIN_RR_GRID.join(",")}).`,
        ),
    }),
    defineValueOption({
      key: "takerFeeRate",
      long: "--taker-fee-rate",
      valueName: "RATE",
      schema: z.coerce
        .number()
        .min(0)
        .max(1)
        .default(POLYMARKET_TAKER_FEE_RATE)
        .describe(
          `Fee rate to assume for taker fills (default ${POLYMARKET_TAKER_FEE_RATE}).`,
        ),
    }),
  ],
  examples: [
    "bun alea trading:calibrate-ev-rr-gate",
    "bun alea trading:calibrate-ev-rr-gate --session tmp/replay-trading/<session>.jsonl",
    "bun alea trading:calibrate-ev-rr-gate --ev-grid 0,0.5,1 --rr-grid 0.2,0.3,0.4",
  ],
  output:
    "Prints baseline stats and three heatmaps (PnL, trades-taken, win-rate) over the (MIN_EV × MIN_RR) grid, plus a featured-points table.",
  sideEffects:
    "Read-only: opens one replay JSONL file. No postgres, no network, no orders.",
  async run({ io, options }) {
    const sessionPath =
      options.session !== undefined
        ? resolvePath(process.cwd(), options.session)
        : await findLatestReplaySession({ replayTradingDir });
    io.writeStdout(`${pc.bold("session")} ${pc.dim(sessionPath)}\n`);

    const { orders, parseErrors, sessionConfig } =
      await loadCalibrationOrdersFromFile({ path: sessionPath });
    if (orders.length === 0) {
      throw new CliUsageError(
        `No usable orders in ${sessionPath} — needs takerCounterfactual + venue-truth outcome on each order.`,
      );
    }
    if (parseErrors.length > 0) {
      io.writeStdout(
        `${pc.yellow("warn")} ${parseErrors.length} parse error(s) — first: ${parseErrors[0]}\n`,
      );
    }

    const evGrid = sortAsc(options.evGrid);
    const rrGrid = sortAsc(options.rrGrid);
    const result = calibrateEvRrGate({
      orders,
      evGrid,
      rrGrid,
      takerFeeRate: options.takerFeeRate,
    });

    printHeader({ io, result, sessionConfig, takerFeeRate: options.takerFeeRate });
    printHeatmaps({ io, result, evGrid, rrGrid });
    printFeaturedPoints({ io, orders, takerFeeRate: options.takerFeeRate });
  },
});

function parseNumericList(value: string | undefined): number[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parts = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => Number(entry));
  if (parts.some((entry) => !Number.isFinite(entry))) {
    throw new CliUsageError(`could not parse '${value}' as a numeric CSV list`);
  }
  return parts.length > 0 ? parts : undefined;
}

function sortAsc(values: readonly number[]): readonly number[] {
  return [...values].sort((a, b) => a - b);
}

function printHeader({
  io,
  result,
  sessionConfig,
  takerFeeRate,
}: {
  readonly io: { writeStdout: (line: string) => void };
  readonly result: CalibrationResult;
  readonly sessionConfig: SessionConfigSummary | null;
  readonly takerFeeRate: number;
}): void {
  if (sessionConfig?.fromMs !== null && sessionConfig?.fromMs !== undefined) {
    io.writeStdout(
      `  ${pc.dim("range:")} ${new Date(sessionConfig.fromMs).toISOString()} → ` +
        `${new Date(sessionConfig.toMs ?? sessionConfig.fromMs).toISOString()}\n`,
    );
  }
  io.writeStdout(
    `  ${pc.dim("orders:")} ${result.orderCount} ${pc.dim("evaluable:")} ${result.evaluableOrderCount}\n` +
      `  ${pc.dim("taker fee rate:")} ${(takerFeeRate * 10000).toFixed(0)} bps\n`,
  );
  io.writeStdout(
    `\n${pc.bold("baseline (no EV/RR gate):")}  ${formatStats({ stats: result.baseline })}\n\n`,
  );
}

function printHeatmaps({
  io,
  result,
  evGrid,
  rrGrid,
}: {
  readonly io: { writeStdout: (line: string) => void };
  readonly result: CalibrationResult;
  readonly evGrid: readonly number[];
  readonly rrGrid: readonly number[];
}): void {
  printHeatmap({
    io,
    title: "PnL ($) heatmap — rows: MIN_EV, cols: MIN_RR",
    evGrid,
    rrGrid,
    cells: result.cells,
    cellRender: (stats) => formatSignedDollarsCell({ value: stats.pnlUsd }),
  });
  printHeatmap({
    io,
    title: "trades-taken heatmap",
    evGrid,
    rrGrid,
    cells: result.cells,
    cellRender: (stats) => stats.taken.toString().padStart(7),
  });
  printHeatmap({
    io,
    title: "win-rate heatmap",
    evGrid,
    rrGrid,
    cells: result.cells,
    cellRender: (stats) => formatPercent({ value: stats.winRate }).padStart(7),
  });
}

function printHeatmap({
  io,
  title,
  evGrid,
  rrGrid,
  cells,
  cellRender,
}: {
  readonly io: { writeStdout: (line: string) => void };
  readonly title: string;
  readonly evGrid: readonly number[];
  readonly rrGrid: readonly number[];
  readonly cells: readonly { minEvUsd: number; minRewardRiskRatio: number; stats: CalibrationCellStats }[];
  readonly cellRender: (stats: CalibrationCellStats) => string;
}): void {
  io.writeStdout(`${pc.bold(title)}\n`);
  const evLabelWidth = 8;
  const colHeader =
    " ".repeat(evLabelWidth + 2) +
    rrGrid.map((rr) => rr.toFixed(2).padStart(7)).join("  ");
  io.writeStdout(`${colHeader}\n`);
  io.writeStdout(`${" ".repeat(evLabelWidth + 2)}${rrGrid.map(() => "-".repeat(7)).join("  ")}\n`);
  for (const ev of evGrid) {
    const row: string[] = [];
    row.push(`$${ev.toFixed(2).padStart(evLabelWidth - 1)}`);
    for (const rr of rrGrid) {
      const cell = cells.find(
        (entry) =>
          entry.minEvUsd === ev && entry.minRewardRiskRatio === rr,
      );
      row.push(cell !== undefined ? cellRender(cell.stats) : "?".padStart(7));
    }
    io.writeStdout(`  ${row.join("  ")}\n`);
  }
  io.writeStdout("\n");
}

function printFeaturedPoints({
  io,
  orders,
  takerFeeRate,
}: {
  readonly io: { writeStdout: (line: string) => void };
  readonly orders: readonly CalibrationOrder[];
  readonly takerFeeRate: number;
}): void {
  io.writeStdout(`${pc.bold("featured points:")}\n`);
  const featured: readonly [number, number][] = [
    [0, 0],
    [0.5, 0.2],
    [0.5, 0.3],
    [0.5, 0.4],
    [1, 0.2],
    [1, 0.3],
    [2, 0.2],
  ];
  for (const [minEvUsd, minRewardRiskRatio] of featured) {
    const result = calibrateEvRrGate({
      orders,
      evGrid: [minEvUsd],
      rrGrid: [minRewardRiskRatio],
      takerFeeRate,
    });
    const stats = result.cells[0]?.stats;
    if (stats === undefined) {
      continue;
    }
    io.writeStdout(
      `  EV≥$${minEvUsd.toFixed(2)} RR≥${minRewardRiskRatio.toFixed(2)}: ` +
        `${formatStats({ stats })}\n`,
    );
  }
}

function formatStats({
  stats,
}: {
  readonly stats: CalibrationCellStats;
}): string {
  return [
    `taken=${stats.taken.toString().padStart(4)}`,
    `wins=${stats.wins.toString().padStart(4)}`,
    `winRate=${formatPercent({ value: stats.winRate })}`,
    `pnl=${formatUsd({ value: stats.pnlUsd })}`,
    `fees=${formatUsd({ value: stats.feesUsd, signed: false })}`,
    `pnl/trade=${formatUsd({ value: stats.pnlPerTrade })}`,
  ].join(" ");
}

function formatSignedDollarsCell({ value }: { readonly value: number }): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(0).padStart(5)}`;
}
