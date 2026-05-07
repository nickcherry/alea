#!/usr/bin/env bun
/**
 * Replay saved probability-table JSON sidecars without overwriting the
 * committed generated table. This is research-only glue for source
 * comparisons: each table carries its own candle source/product, and
 * runReplay uses that series to hydrate regime trackers.
 *
 * Usage:
 *   bun src/bin/research/replaySavedProbabilityTables.ts --from 2026-05-07T13:05:00Z --to 2026-05-07T14:35:00Z name:path ...
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import { runReplay } from "@alea/lib/trading/replay/runReplay";
import type { ReplayTickSource } from "@alea/lib/trading/replay/types";
import type { ProbabilityTable } from "@alea/lib/trading/types";
import type { Asset } from "@alea/types/assets";

const DEFAULT_TABLES = [
  {
    name: "binance/perp",
    path: "tmp/probability-table_2026-05-07T12-49-59-111Z.json",
  },
  {
    name: "binance/spot",
    path: "tmp/probability-table_2026-05-07T12-54-25-895Z.json",
  },
  {
    name: "coinbase/perp",
    path: "tmp/probability-table_2026-05-07T12-58-51-742Z.json",
  },
  {
    name: "coinbase/spot",
    path: "tmp/probability-table_2026-05-07T13-03-16-472Z.json",
  },
] as const;

type TableInput = {
  readonly name: string;
  readonly path: string;
};

type Options = {
  readonly fromMs: number;
  readonly toMs: number;
  readonly minEdge: number;
  readonly tickSource: ReplayTickSource;
  readonly tables: readonly TableInput[];
};

async function main(): Promise<void> {
  const options = parseArgs({ args: process.argv.slice(2) });
  const db = createDatabase();
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());

  try {
    for (const input of options.tables) {
      const table = loadTable({ path: input.path });
      const assets = table.assets.map((asset) => asset.asset);
      console.log(
        `\n=== ${input.name} === from=${new Date(options.fromMs).toISOString()} to=${new Date(options.toMs).toISOString()} series=${table.series.source}/${table.series.product} tick=${options.tickSource}`,
      );
      const result = await runReplay({
        db,
        assets,
        fromMs: options.fromMs,
        toMs: options.toMs,
        table,
        minEdge: options.minEdge,
        tickSource: options.tickSource,
        candleSource: table.series.source,
        candleProduct: table.series.product,
        signal: controller.signal,
        emit: (event) => {
          if (event.kind === "info" || event.kind === "warn") {
            console.log(event.message);
          }
        },
      });
      console.log(
        [
          "RESULT",
          input.name,
          `windows=${result.windowsProcessed}`,
          `skipped=${result.windowsSkipped}`,
          `orders=${result.sessionMetrics.orderCount}`,
          `canonicalPnl=${result.sessionMetrics.canonical.pnlUsd.toFixed(2)}`,
          `allFilledPnl=${result.sessionMetrics.allOrdersFilled.pnlUsd.toFixed(2)}`,
          `log=${result.logPath}`,
        ].join(" "),
      );
    }
  } finally {
    await destroyDatabase(db);
  }
}

function parseArgs({ args }: { readonly args: readonly string[] }): Options {
  let fromMs = Date.parse("2026-05-07T13:05:00Z");
  let toMs = Date.parse("2026-05-07T14:35:00Z");
  let minEdge = 0.05;
  let tickSource: ReplayTickSource = "coinbase-spot";
  const tables: TableInput[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--from") {
      fromMs = parseIso({ label: "--from", value: args[index + 1] });
      index += 1;
      continue;
    }
    if (arg === "--to") {
      toMs = parseIso({ label: "--to", value: args[index + 1] });
      index += 1;
      continue;
    }
    if (arg === "--min-edge") {
      minEdge = parseNumber({ label: "--min-edge", value: args[index + 1] });
      index += 1;
      continue;
    }
    if (arg === "--tick-source") {
      tickSource = parseTickSource({ value: args[index + 1] });
      index += 1;
      continue;
    }
    tables.push(parseTableArg({ arg }));
  }

  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw new Error("--to must be after --from");
  }
  return {
    fromMs,
    toMs,
    minEdge,
    tickSource,
    tables: tables.length === 0 ? DEFAULT_TABLES : tables,
  };
}

function parseIso({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | undefined;
}): number {
  if (value === undefined) {
    throw new Error(`${label} requires an ISO timestamp`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`${label} must be an ISO timestamp, got ${value}`);
  }
  return ms;
}

function parseNumber({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | undefined;
}): number {
  if (value === undefined) {
    throw new Error(`${label} requires a number`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be numeric, got ${value}`);
  }
  return parsed;
}

function parseTickSource({
  value,
}: {
  readonly value: string | undefined;
}): ReplayTickSource {
  if (
    value === "binance-perp" ||
    value === "coinbase-spot" ||
    value === "coinbase-perp"
  ) {
    return value;
  }
  throw new Error(
    `--tick-source must be binance-perp, coinbase-spot, or coinbase-perp; got ${value}`,
  );
}

function parseTableArg({ arg }: { readonly arg: string }): TableInput {
  const separator = arg.indexOf(":");
  if (separator <= 0 || separator === arg.length - 1) {
    throw new Error(`table args must be name:path, got ${arg}`);
  }
  return {
    name: arg.slice(0, separator),
    path: arg.slice(separator + 1),
  };
}

function loadTable({ path }: { readonly path: string }): ProbabilityTable {
  const raw = JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`invalid probability table JSON at ${path}`);
  }
  const table = raw as ProbabilityTable;
  for (const asset of table.assets) {
    assertAsset(asset.asset, path);
  }
  return table;
}

function assertAsset(value: string, path: string): asserts value is Asset {
  if (
    value !== "btc" &&
    value !== "eth" &&
    value !== "sol" &&
    value !== "xrp" &&
    value !== "doge"
  ) {
    throw new Error(`invalid asset ${value} in ${path}`);
  }
}

await main();
