#!/usr/bin/env bun
/**
 * Cross-source replay consensus analyzer.
 *
 * Loads multiple replay JSONLs from the same captured tape and asks:
 * if one execution table wants to trade, do other independently-trained
 * tables agree on the same asset/window/side? This is a research-only
 * overfit check; it does not touch live trading.
 *
 * Usage:
 *   bun src/bin/research/compareReplayConsensus.ts name:path name:path ...
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Asset = "btc" | "eth" | "sol" | "xrp" | "doge";
type Side = "up" | "down";

type ReplayOrder = {
  readonly source: string;
  readonly asset: Asset;
  readonly side: Side;
  readonly windowStartMs: number;
  readonly placedAtMs: number;
  readonly edge: number | null;
  readonly chosenSpread: number | null;
  readonly chosenBestAsk: number | null;
  readonly signedDistanceBp: number | null;
  readonly limitPrice: number;
  readonly officialOutcome: Side;
  readonly takerFillSize: number | null;
  readonly takerAvgPrice: number | null;
  readonly takerCostUsd: number | null;
};

type FilterSpec = {
  readonly label: string;
  readonly minEdge: number;
  readonly maxChosenSpread?: number;
  readonly maxChosenBestAsk?: number;
  readonly minTrendConfirmBp?: number;
  readonly excludeAssets?: readonly Asset[];
};

type Metrics = {
  readonly orders: number;
  readonly pnlUsd: number;
  readonly winRate: number | null;
  readonly worstQuarterPnlUsd: number;
  readonly usOrders: number;
  readonly usPnlUsd: number;
  readonly usWinRate: number | null;
  readonly slippageOneTickPnlUsd: number;
};

const DEFAULT_SOURCES = [
  {
    name: "binance/perp",
    path: "tmp/replay-trading/replay-trading_2026-05-07T12-49-59.321Z.jsonl",
  },
  {
    name: "binance/spot",
    path: "tmp/replay-trading/replay-trading_2026-05-07T12-54-26.121Z.jsonl",
  },
  {
    name: "coinbase/perp",
    path: "tmp/replay-trading/replay-trading_2026-05-07T12-58-51.970Z.jsonl",
  },
  {
    name: "coinbase/spot",
    path: "tmp/replay-trading/replay-trading_2026-05-07T13-03-16.698Z.jsonl",
  },
] as const;

const FILTERS: readonly FilterSpec[] = [
  {
    label: "consensus-core BTC/ETH/SOL edge05 spread07",
    minEdge: 0.05,
    maxChosenSpread: 0.07,
    excludeAssets: ["doge", "xrp"],
  },
  {
    label: "consensus-core BTC/ETH/SOL edge05 spread07 ask75",
    minEdge: 0.05,
    maxChosenSpread: 0.07,
    maxChosenBestAsk: 0.75,
    excludeAssets: ["doge", "xrp"],
  },
  {
    label: "consensus-core BTC/ETH/SOL edge05 spread07 trend0",
    minEdge: 0.05,
    maxChosenSpread: 0.07,
    minTrendConfirmBp: 0,
    excludeAssets: ["doge", "xrp"],
  },
  {
    label: "consensus-core BTC/ETH/SOL edge05 spread07 ask75 trend0",
    minEdge: 0.05,
    maxChosenSpread: 0.07,
    maxChosenBestAsk: 0.75,
    minTrendConfirmBp: 0,
    excludeAssets: ["doge", "xrp"],
  },
  {
    label: "consensus-core no DOGE edge05 spread07",
    minEdge: 0.05,
    maxChosenSpread: 0.07,
    excludeAssets: ["doge"],
  },
  {
    label: "consensus-core all assets edge05 spread07",
    minEdge: 0.05,
    maxChosenSpread: 0.07,
  },
  {
    label: "tight-spread all assets",
    minEdge: 0.06,
    maxChosenSpread: 0.08,
  },
  {
    label: "tight-spread no DOGE",
    minEdge: 0.06,
    maxChosenSpread: 0.08,
    excludeAssets: ["doge"],
  },
  {
    label: "tight-spread BTC/ETH/SOL",
    minEdge: 0.06,
    maxChosenSpread: 0.08,
    excludeAssets: ["doge", "xrp"],
  },
  {
    label: "high-edge all assets",
    minEdge: 0.15,
  },
  {
    label: "high-edge no DOGE",
    minEdge: 0.15,
    excludeAssets: ["doge"],
  },
];

const TAKER_FEE_BPS = 720;
const STAKE_USD = 20;

function main(): void {
  const sourceArgs = process.argv.slice(2);
  const sourceInputs =
    sourceArgs.length === 0
      ? DEFAULT_SOURCES
      : sourceArgs.map((arg) => parseSourceArg({ arg }));
  const bySource = new Map<string, readonly ReplayOrder[]>();
  for (const input of sourceInputs) {
    bySource.set(
      input.name,
      loadOrders({ source: input.name, path: input.path }),
    );
  }
  const sourceNames = sourceInputs.map((input) => input.name);

  console.log(`loaded sources: ${sourceNames.join(", ")}`);
  for (const filter of FILTERS) {
    console.log(`\n=== ${filter.label} ===`);
    printHeader();
    for (const executionSource of sourceNames) {
      for (const requiredAgreeingSources of sourceNames.map(
        (_sourceName, index) => index + 1,
      )) {
        const selected = selectConsensusOrders({
          bySource,
          sourceNames,
          executionSource,
          filter,
          requiredAgreeingSources,
        });
        const metrics = computeMetrics({ orders: selected });
        printRow({
          executionSource,
          requiredAgreeingSources,
          metrics,
        });
      }
    }
  }
}

function parseSourceArg({ arg }: { readonly arg: string }): {
  readonly name: string;
  readonly path: string;
} {
  const separator = arg.indexOf(":");
  if (separator <= 0 || separator === arg.length - 1) {
    throw new Error(`source args must be name:path, got ${arg}`);
  }
  return {
    name: arg.slice(0, separator),
    path: arg.slice(separator + 1),
  };
}

function loadOrders({
  source,
  path,
}: {
  readonly source: string;
  readonly path: string;
}): readonly ReplayOrder[] {
  const text = readFileSync(resolve(path), "utf8");
  const orders: ReplayOrder[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      continue;
    }
    const row = parsed as Record<string, unknown>;
    if (row["type"] !== "window_finalized" || !Array.isArray(row["orders"])) {
      continue;
    }
    for (const raw of row["orders"]) {
      if (typeof raw !== "object" || raw === null) {
        continue;
      }
      const order = parseOrder({
        source,
        raw: raw as Record<string, unknown>,
      });
      if (order !== null) {
        orders.push(order);
      }
    }
  }
  return orders;
}

function parseOrder({
  source,
  raw,
}: {
  readonly source: string;
  readonly raw: Record<string, unknown>;
}): ReplayOrder | null {
  const asset = raw["asset"];
  const side = raw["side"];
  const officialOutcome = raw["officialOutcome"];
  const windowStartMs = raw["windowStartMs"];
  const placedAtMs = raw["placedAtMs"];
  const limitPrice = raw["limitPrice"];
  if (
    !isAsset(asset) ||
    !isSide(side) ||
    !isSide(officialOutcome) ||
    typeof windowStartMs !== "number" ||
    typeof placedAtMs !== "number" ||
    typeof limitPrice !== "number"
  ) {
    return null;
  }
  const entryBookTelemetry = raw["entryBookTelemetry"];
  const book =
    typeof entryBookTelemetry === "object" && entryBookTelemetry !== null
      ? (entryBookTelemetry as Record<string, unknown>)
      : null;
  const entryPriceTelemetry = raw["entryPriceTelemetry"];
  const priceTelemetry =
    typeof entryPriceTelemetry === "object" && entryPriceTelemetry !== null
      ? (entryPriceTelemetry as Record<string, unknown>)
      : null;
  const takerCounterfactual = raw["takerCounterfactual"];
  const taker =
    typeof takerCounterfactual === "object" && takerCounterfactual !== null
      ? (takerCounterfactual as Record<string, unknown>)
      : null;
  return {
    source,
    asset,
    side,
    windowStartMs,
    placedAtMs,
    edge: numberOrNull({ value: raw["edge"] }),
    chosenSpread:
      book === null ? null : numberOrNull({ value: book["chosenSpread"] }),
    chosenBestAsk:
      book === null ? null : numberOrNull({ value: book["chosenBestAsk"] }),
    signedDistanceBp:
      priceTelemetry === null
        ? null
        : numberOrNull({ value: priceTelemetry["signedDistanceBp"] }),
    limitPrice,
    officialOutcome,
    takerFillSize:
      taker === null
        ? null
        : (numberOrNull({ value: taker["fillSize"] }) ??
          numberOrNull({ value: taker["sharesIfFilled"] })),
    takerAvgPrice:
      taker === null
        ? null
        : (numberOrNull({ value: taker["avgPrice"] }) ??
          numberOrNull({ value: taker["askPrice"] })),
    takerCostUsd:
      taker === null ? null : numberOrNull({ value: taker["costUsd"] }),
  };
}

function isAsset(value: unknown): value is Asset {
  return (
    value === "btc" ||
    value === "eth" ||
    value === "sol" ||
    value === "xrp" ||
    value === "doge"
  );
}

function isSide(value: unknown): value is Side {
  return value === "up" || value === "down";
}

function numberOrNull({ value }: { readonly value: unknown }): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function selectConsensusOrders({
  bySource,
  sourceNames,
  executionSource,
  filter,
  requiredAgreeingSources,
}: {
  readonly bySource: ReadonlyMap<string, readonly ReplayOrder[]>;
  readonly sourceNames: readonly string[];
  readonly executionSource: string;
  readonly filter: FilterSpec;
  readonly requiredAgreeingSources: number;
}): readonly ReplayOrder[] {
  const indexes = new Map<string, ReadonlyMap<string, ReplayOrder>>();
  for (const sourceName of sourceNames) {
    indexes.set(
      sourceName,
      buildOrderIndex({
        orders: bySource.get(sourceName) ?? [],
        filter,
      }),
    );
  }
  const executionOrders = indexes.get(executionSource);
  if (executionOrders === undefined) {
    throw new Error(`missing execution source ${executionSource}`);
  }
  const selected: ReplayOrder[] = [];
  for (const order of executionOrders.values()) {
    const key = orderKey({ order });
    let agreeingSources = 0;
    for (const sourceName of sourceNames) {
      const candidate = indexes.get(sourceName)?.get(key);
      if (candidate !== undefined) {
        agreeingSources += 1;
      }
    }
    if (agreeingSources >= requiredAgreeingSources) {
      selected.push(order);
    }
  }
  return selected.sort((a, b) => a.placedAtMs - b.placedAtMs);
}

function buildOrderIndex({
  orders,
  filter,
}: {
  readonly orders: readonly ReplayOrder[];
  readonly filter: FilterSpec;
}): ReadonlyMap<string, ReplayOrder> {
  const index = new Map<string, ReplayOrder>();
  for (const order of orders) {
    if (!passesFilter({ order, filter })) {
      continue;
    }
    const key = orderKey({ order });
    const existing = index.get(key);
    if (
      existing === undefined ||
      edgeValue({ order }) > edgeValue({ order: existing })
    ) {
      index.set(key, order);
    }
  }
  return index;
}

function edgeValue({ order }: { readonly order: ReplayOrder }): number {
  return order.edge ?? Number.NEGATIVE_INFINITY;
}

function passesFilter({
  order,
  filter,
}: {
  readonly order: ReplayOrder;
  readonly filter: FilterSpec;
}): boolean {
  if (order.edge === null || order.edge < filter.minEdge) {
    return false;
  }
  if (
    filter.maxChosenSpread !== undefined &&
    (order.chosenSpread === null || order.chosenSpread > filter.maxChosenSpread)
  ) {
    return false;
  }
  if (
    filter.maxChosenBestAsk !== undefined &&
    (order.chosenBestAsk === null ||
      order.chosenBestAsk > filter.maxChosenBestAsk)
  ) {
    return false;
  }
  if (
    filter.minTrendConfirmBp !== undefined &&
    (order.signedDistanceBp === null ||
      trendConfirmBp({ order }) < filter.minTrendConfirmBp)
  ) {
    return false;
  }
  if (
    filter.excludeAssets !== undefined &&
    filter.excludeAssets.includes(order.asset)
  ) {
    return false;
  }
  return true;
}

function trendConfirmBp({ order }: { readonly order: ReplayOrder }): number {
  const signed = order.signedDistanceBp ?? 0;
  return order.side === "down" ? -signed : signed;
}

function orderKey({ order }: { readonly order: ReplayOrder }): string {
  return `${order.asset}:${order.windowStartMs}:${order.side}`;
}

function computeMetrics({
  orders,
}: {
  readonly orders: readonly ReplayOrder[];
}): Metrics {
  const pnlUsd = sum(
    orders.map((order) => takerPnl({ order, slippageTicks: 0 })),
  );
  const slippageOneTickPnlUsd = sum(
    orders.map((order) => takerPnl({ order, slippageTicks: 1 })),
  );
  const wins = orders.filter(
    (order) => order.side === order.officialOutcome,
  ).length;
  const usOrders = orders.filter((order) => isUsHour({ order }));
  const usWins = usOrders.filter(
    (order) => order.side === order.officialOutcome,
  ).length;
  return {
    orders: orders.length,
    pnlUsd,
    winRate: orders.length === 0 ? null : wins / orders.length,
    worstQuarterPnlUsd: worstQuarterPnl({ orders }),
    usOrders: usOrders.length,
    usPnlUsd: sum(
      usOrders.map((order) => takerPnl({ order, slippageTicks: 0 })),
    ),
    usWinRate: usOrders.length === 0 ? null : usWins / usOrders.length,
    slippageOneTickPnlUsd,
  };
}

function takerPnl({
  order,
  slippageTicks,
}: {
  readonly order: ReplayOrder;
  readonly slippageTicks: number;
}): number {
  if (
    order.takerFillSize !== null &&
    order.takerFillSize > 0 &&
    order.takerAvgPrice !== null &&
    order.takerAvgPrice > 0 &&
    order.takerAvgPrice < 1
  ) {
    const price = Math.min(0.99, order.takerAvgPrice + slippageTicks * 0.01);
    const cost =
      (order.takerCostUsd ?? order.takerFillSize * order.takerAvgPrice) +
      order.takerFillSize * Math.max(0, price - order.takerAvgPrice);
    const gross = order.side === order.officialOutcome ? order.takerFillSize : 0;
    const fee =
      order.takerFillSize * (TAKER_FEE_BPS / 10_000) * price * (1 - price);
    return gross - cost - fee;
  }
  const baseAsk =
    order.chosenBestAsk ?? Math.min(0.99, order.limitPrice + 0.01);
  if (baseAsk <= 0 || baseAsk >= 1) {
    return 0;
  }
  const price = Math.min(0.99, baseAsk + slippageTicks * 0.01);
  const shares = Math.floor((STAKE_USD / price) * 100) / 100;
  const gross = order.side === order.officialOutcome ? shares : 0;
  const cost = shares * price;
  const fee = shares * (TAKER_FEE_BPS / 10_000) * price * (1 - price);
  return gross - cost - fee;
}

function worstQuarterPnl({
  orders,
}: {
  readonly orders: readonly ReplayOrder[];
}): number {
  if (orders.length === 0) {
    return 0;
  }
  const sorted = [...orders].sort((a, b) => a.placedAtMs - b.placedAtMs);
  const minMs = sorted[0]?.placedAtMs ?? 0;
  const maxMs = sorted[sorted.length - 1]?.placedAtMs ?? minMs;
  const bucketMs = Math.max(1, Math.ceil((maxMs - minMs) / 4));
  let worst = Number.POSITIVE_INFINITY;
  for (let bucket = 0; bucket < 4; bucket += 1) {
    const lo = minMs + bucket * bucketMs;
    const hi = bucket === 3 ? Number.POSITIVE_INFINITY : lo + bucketMs;
    const bucketOrders = sorted.filter(
      (order) => order.placedAtMs >= lo && order.placedAtMs < hi,
    );
    const pnl = sum(
      bucketOrders.map((order) => takerPnl({ order, slippageTicks: 0 })),
    );
    worst = Math.min(worst, pnl);
  }
  return worst === Number.POSITIVE_INFINITY ? 0 : worst;
}

function isUsHour({ order }: { readonly order: ReplayOrder }): boolean {
  const hour = new Date(order.placedAtMs).getUTCHours();
  return hour >= 16 && hour <= 23;
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function printHeader(): void {
  console.log(
    [
      "exec".padEnd(14),
      "agree",
      "n".padStart(4),
      "pnl".padStart(9),
      "1tk".padStart(9),
      "win".padStart(6),
      "worstQ".padStart(9),
      "USn".padStart(4),
      "USpnl".padStart(9),
      "USwin".padStart(6),
    ].join(" | "),
  );
}

function printRow({
  executionSource,
  requiredAgreeingSources,
  metrics,
}: {
  readonly executionSource: string;
  readonly requiredAgreeingSources: number;
  readonly metrics: Metrics;
}): void {
  console.log(
    [
      executionSource.padEnd(14),
      String(requiredAgreeingSources).padStart(5),
      String(metrics.orders).padStart(4),
      formatUsd({ value: metrics.pnlUsd }).padStart(9),
      formatUsd({ value: metrics.slippageOneTickPnlUsd }).padStart(9),
      formatPercent({ value: metrics.winRate }).padStart(6),
      formatUsd({ value: metrics.worstQuarterPnlUsd }).padStart(9),
      String(metrics.usOrders).padStart(4),
      formatUsd({ value: metrics.usPnlUsd }).padStart(9),
      formatPercent({ value: metrics.usWinRate }).padStart(6),
    ].join(" | "),
  );
}

function formatUsd({ value }: { readonly value: number }): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(value).toFixed(0)}`;
}

function formatPercent({ value }: { readonly value: number | null }): string {
  return value === null ? "--" : `${(value * 100).toFixed(0)}%`;
}

main();
