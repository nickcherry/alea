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
import type { DatabaseClient } from "@alea/lib/db/types";
import {
  currentWindowStartMs,
  FIVE_MINUTES_MS,
} from "@alea/lib/livePrices/fiveMinuteWindow";
import type {
  DecisionSkipReason,
  TradeDecision,
} from "@alea/lib/trading/decision/types";
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
      const diagnostics = createDecisionDiagnostics();
      const coverage = await loadCandleCoverage({
        db,
        assets,
        table,
        firstWindowStartMs: currentWindowStartMs({ nowMs: options.fromMs }),
      });
      console.log(formatCandleCoverage({ coverage }));
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
          if (event.kind === "decision") {
            recordDecisionDiagnostic({ diagnostics, decision: event.decision });
            return;
          }
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
      console.log(formatDecisionDiagnostics({ diagnostics }));
    }
  } finally {
    await destroyDatabase(db);
  }
}

type CandleCoverage = {
  readonly source: string;
  readonly product: string;
  readonly requiredLastOpenMs: number;
  readonly latestByAsset: ReadonlyMap<Asset, number | null>;
};

async function loadCandleCoverage({
  db,
  assets,
  table,
  firstWindowStartMs,
}: {
  readonly db: DatabaseClient;
  readonly assets: readonly Asset[];
  readonly table: ProbabilityTable;
  readonly firstWindowStartMs: number;
}): Promise<CandleCoverage> {
  const requiredLastOpenMs = firstWindowStartMs - FIVE_MINUTES_MS;
  const rows = await db
    .selectFrom("candles")
    .select(["asset"])
    .select((eb) => eb.fn.max("timestamp").as("latest_timestamp"))
    .where("source", "=", table.series.source)
    .where("product", "=", table.series.product)
    .where("timeframe", "=", "5m")
    .where("asset", "in", [...assets])
    .where("timestamp", "<", new Date(firstWindowStartMs))
    .groupBy("asset")
    .execute();

  const latestByAsset = new Map<Asset, number | null>();
  for (const asset of assets) {
    latestByAsset.set(asset, null);
  }
  for (const row of rows) {
    assertAsset(row.asset, "candles table");
    latestByAsset.set(row.asset, timestampMs({ value: row.latest_timestamp }));
  }

  return {
    source: table.series.source,
    product: table.series.product,
    requiredLastOpenMs,
    latestByAsset,
  };
}

function formatCandleCoverage({
  coverage,
}: {
  readonly coverage: CandleCoverage;
}): string {
  const stale = Array.from(coverage.latestByAsset.entries()).filter(
    ([, latestMs]) =>
      latestMs === null || latestMs < coverage.requiredLastOpenMs,
  );
  const latest = Array.from(coverage.latestByAsset.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([asset, latestMs]) =>
        `${asset}:${latestMs === null ? "none" : new Date(latestMs).toISOString()}`,
    )
    .join(",");
  return [
    "CANDLES",
    `series=${coverage.source}/${coverage.product}`,
    `requiredLastBar=${new Date(coverage.requiredLastOpenMs).toISOString()}`,
    `status=${stale.length === 0 ? "fresh" : `stale(${stale.map(([asset]) => asset).join(",")})`}`,
    `latest=${latest}`,
  ].join(" ");
}

function timestampMs({
  value,
}: {
  readonly value: Date | string | null;
}): number | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type DecisionDiagnostics = {
  decisions: number;
  trades: number;
  skips: number;
  skipsWithoutSnapshot: number;
  readonly skipsByReason: Map<DecisionSkipReason, number>;
  readonly decisionsByAsset: Map<Asset, number>;
  readonly tradesByAsset: Map<Asset, number>;
  readonly skipsByAssetReason: Map<Asset, Map<DecisionSkipReason, number>>;
};

function createDecisionDiagnostics(): DecisionDiagnostics {
  return {
    decisions: 0,
    trades: 0,
    skips: 0,
    skipsWithoutSnapshot: 0,
    skipsByReason: new Map(),
    decisionsByAsset: new Map(),
    tradesByAsset: new Map(),
    skipsByAssetReason: new Map(),
  };
}

function recordDecisionDiagnostic({
  diagnostics,
  decision,
}: {
  readonly diagnostics: DecisionDiagnostics;
  readonly decision: TradeDecision;
}): void {
  diagnostics.decisions += 1;
  const asset = decision.snapshot?.asset ?? null;
  if (asset !== null) {
    incrementMap({ map: diagnostics.decisionsByAsset, key: asset });
  }

  if (decision.kind === "trade") {
    diagnostics.trades += 1;
    incrementMap({ map: diagnostics.tradesByAsset, key: decision.snapshot.asset });
    return;
  }

  diagnostics.skips += 1;
  incrementMap({ map: diagnostics.skipsByReason, key: decision.reason });
  if (asset === null) {
    diagnostics.skipsWithoutSnapshot += 1;
    return;
  }
  let byReason = diagnostics.skipsByAssetReason.get(asset);
  if (byReason === undefined) {
    byReason = new Map();
    diagnostics.skipsByAssetReason.set(asset, byReason);
  }
  incrementMap({ map: byReason, key: decision.reason });
}

function formatDecisionDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: DecisionDiagnostics;
}): string {
  const parts = [
    "DECISIONS",
    `total=${diagnostics.decisions}`,
    `trades=${diagnostics.trades}`,
    `skips=${diagnostics.skips}`,
    `skipReasons=${formatMap({ map: diagnostics.skipsByReason })}`,
  ];
  if (diagnostics.skipsWithoutSnapshot > 0) {
    parts.push(`skipNoSnapshot=${diagnostics.skipsWithoutSnapshot}`);
  }
  const assets = formatAssetDiagnostics({ diagnostics });
  if (assets.length > 0) {
    parts.push(`byAsset=${assets.join(";")}`);
  }
  return parts.join(" ");
}

function formatAssetDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: DecisionDiagnostics;
}): string[] {
  const assets = new Set<Asset>([
    ...diagnostics.decisionsByAsset.keys(),
    ...diagnostics.tradesByAsset.keys(),
    ...diagnostics.skipsByAssetReason.keys(),
  ]);
  return Array.from(assets)
    .sort()
    .map((asset) => {
      const decisions = diagnostics.decisionsByAsset.get(asset) ?? 0;
      const trades = diagnostics.tradesByAsset.get(asset) ?? 0;
      const skips = diagnostics.skipsByAssetReason.get(asset) ?? new Map();
      return `${asset}:decisions=${decisions},trades=${trades},skips=${formatMap({ map: skips })}`;
    });
}

function formatMap<K extends string>({
  map,
}: {
  readonly map: ReadonlyMap<K, number>;
}): string {
  if (map.size === 0) {
    return "none";
  }
  return Array.from(map.entries())
    .sort((left, right) => {
      const countDelta = right[1] - left[1];
      if (countDelta !== 0) {
        return countDelta;
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([key, count]) => `${key}:${count}`)
    .join(",");
}

function incrementMap<K>({
  map,
  key,
}: {
  readonly map: Map<K, number>;
  readonly key: K;
}): void {
  map.set(key, (map.get(key) ?? 0) + 1);
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
