#!/usr/bin/env bun
/**
 * Post-hoc analyzer for replay JSONL sessions. Loads a session,
 * extracts per-order records (asset, side, limitPrice, fill info,
 * regime, edge, telemetry, chainlink outcome), and lets the caller
 * sweep filter combinations (min-edge, per-asset, per-regime,
 * remaining-min, queue-depth, side, etc.) without re-running the
 * replay engine. PnL is computed under the same canonical/touch/
 * all-filled lenses the production report uses.
 *
 * This is a research-only tool — it does not modify any committed
 * data and never touches the live decision path.
 *
 * Usage:
 *   bun src/bin/research/sweepReplay.ts <jsonl-path> [--sweep min-edge|asset|regime|remaining|queue|side|combos]
 *   bun src/bin/research/sweepReplay.ts <jsonl-path> --filter '{"minEdge":0.10,"assets":["btc","eth"]}'
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type LeadingSide = "up" | "down";
type Asset = "btc" | "eth" | "sol" | "xrp" | "doge";

type ReplayOrder = {
  readonly asset: Asset;
  readonly side: LeadingSide;
  readonly limitPrice: number;
  readonly sharesIfFilled: number;
  readonly canonicalFilledShares: number;
  readonly canonicalCostUsd: number;
  readonly touchFilledAtMs: number | null;
  readonly queueAheadShares: number | null;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly placedAtMs: number;
  readonly remainingMin: number | null;
  readonly distanceBp: number | null;
  readonly modelProbability: number | null;
  readonly edge: number | null;
  readonly regimeAlgoLabel: string | null;
  readonly officialOutcome: LeadingSide | null;
  readonly proxyOutcome: LeadingSide | null;
  readonly takerBestAskFillSize: number | null;
  readonly takerBestAskAvgPrice: number | null;
  readonly takerEstFeeUsd: number | null;
  // telemetry-derived features used for filtering
  readonly signedDistanceBp: number | null;
  readonly entry5sDeltaBp: number | null;
  readonly entry15sDeltaBp: number | null;
  readonly entry30sDeltaBp: number | null;
  readonly entry60sDeltaBp: number | null;
  readonly preEntry30sPriceDelta: number | null;
  readonly preEntry30sBelowLimit: number | null;
  readonly preEntry30sAtOrBelow: number | null;
  readonly preEntry30sTradeCount: number | null;
  readonly preEntry15sBelowLimit: number | null;
  readonly chosenSpread: number | null;
  readonly oppositeSpread: number | null;
  readonly chosenAskSizeAtBestAsk: number | null;
};

type FilterSpec = {
  readonly assets?: readonly Asset[];
  readonly excludeAssets?: readonly Asset[];
  readonly minEdge?: number;
  readonly maxEdge?: number;
  readonly minProb?: number;
  readonly maxProb?: number;
  readonly sides?: readonly LeadingSide[];
  readonly minRemainingMin?: number;
  readonly maxRemainingMin?: number;
  readonly minQueueAheadShares?: number;
  readonly maxQueueAheadShares?: number;
  readonly maxLimitPrice?: number;
  readonly minLimitPrice?: number;
  readonly maxDistanceBp?: number;
  readonly regimeIncludes?: readonly string[];
  readonly regimeExcludes?: readonly string[];
  // telemetry-based gates
  readonly minSignedDistanceBp?: number; // require price already moved into our side by N bps
  readonly maxSignedDistanceBp?: number;
  /**
   * Symmetric "trend-confirmation" gate. Computes
   * `distInOurSide = (side === "down") ? -signedDistanceBp : signedDistanceBp`
   * — positive when price has moved INTO our chosen side. The filter
   * keeps orders where `distInOurSide >= minTrendConfirmBp`.
   */
  readonly minTrendConfirmBp?: number;
  readonly maxTrendConfirmBp?: number;
  /**
   * Side-aligned recent-momentum gate. Computes
   * `momentumInOurSide = (side === "down") ? -entry30sDeltaBp : entry30sDeltaBp`
   * — positive when the price moved toward our chosen side over the
   * past 30s. Filter keeps orders where it exceeds the threshold.
   */
  readonly minSideAlignedMomentumBp?: number;
  readonly maxSideAlignedMomentumBp?: number;
  /**
   * 60s analog.
   */
  readonly minSideAlignedMomentum60sBp?: number;
  readonly minPreEntry30sFavorableDelta?: number; // signed: positive == favorable for our side
  readonly maxPreEntry30sBelowLimit?: number; // skip if too many trades already cut through limit
  readonly minPreEntry30sTradeCount?: number;
  readonly maxChosenSpread?: number;
  readonly maxOppositeSpread?: number;
  readonly minChosenAskSizeAtBestAsk?: number;
};

type LensMetrics = {
  readonly orderCount: number;
  readonly filledCount: number;
  readonly fillRate: number;
  readonly winRate: number | null;
  readonly pnlUsd: number;
  readonly pnlPerOrderUsd: number;
  readonly pnlPerFilledUsd: number | null;
  readonly avgEdge: number | null;
  readonly avgLimit: number | null;
  readonly avgQueue: number | null;
};

type SweepResult = {
  readonly label: string;
  readonly canonical: LensMetrics;
  readonly touch: LensMetrics;
  readonly allFilled: LensMetrics;
};

function loadOrders({ path }: { readonly path: string }): readonly ReplayOrder[] {
  const text = readFileSync(path, "utf8");
  const out: ReplayOrder[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const obj = parsed as Record<string, unknown>;
    if (obj["type"] !== "window_finalized") continue;
    const orders = obj["orders"];
    if (!Array.isArray(orders)) continue;
    for (const o of orders) {
      if (typeof o !== "object" || o === null) continue;
      const order = parseOrder(o as Record<string, unknown>);
      if (order !== null) out.push(order);
    }
  }
  return out;
}

function parseOrder(raw: Record<string, unknown>): ReplayOrder | null {
  const asset = raw["asset"];
  const side = raw["side"];
  const limitPrice = raw["limitPrice"];
  const sharesIfFilled = raw["sharesIfFilled"];
  if (
    typeof asset !== "string" ||
    typeof side !== "string" ||
    typeof limitPrice !== "number" ||
    typeof sharesIfFilled !== "number"
  ) {
    return null;
  }
  const officialRaw = raw["officialOutcome"];
  const officialOutcome: LeadingSide | null =
    officialRaw === "up" || officialRaw === "down" ? officialRaw : null;
  if (officialOutcome === null) return null;

  const regimeRaw = raw["regime"];
  const regimeAlgoLabel =
    typeof regimeRaw === "string" ? regimeRaw : null;

  const ept = raw["entryPriceTelemetry"] as
    | Record<string, unknown>
    | null
    | undefined;
  const eptLookbacks = (ept !== null && ept !== undefined
    ? (ept["lookbacks"] as unknown[] | undefined) ?? []
    : []) as Array<Record<string, unknown>>;
  const findLookback = (ms: number) =>
    eptLookbacks.find((lb) => lb["lookbackMs"] === ms);
  const lb5 = findLookback(5000);
  const lb15 = findLookback(15000);
  const lb30 = findLookback(30000);
  const lb60 = findLookback(60000);

  const ebt = raw["entryBookTelemetry"] as
    | Record<string, unknown>
    | null
    | undefined;

  const pmt = raw["preEntryMarketTelemetry"] as
    | Record<string, unknown>
    | null
    | undefined;
  const pmtLookbacks = (pmt !== null && pmt !== undefined
    ? (pmt["lookbacks"] as unknown[] | undefined) ?? []
    : []) as Array<Record<string, unknown>>;
  const pmt15 = pmtLookbacks.find((lb) => lb["lookbackMs"] === 15000);
  const pmt30 = pmtLookbacks.find((lb) => lb["lookbackMs"] === 30000);

  const tc = raw["takerCounterfactual"] as
    | Record<string, unknown>
    | null
    | undefined;
  const takerBestAskFillSize =
    tc !== null && tc !== undefined && typeof tc["fillSize"] === "number"
      ? (tc["fillSize"] as number)
      : null;
  const takerBestAskAvgPrice =
    tc !== null && tc !== undefined && typeof tc["avgPrice"] === "number"
      ? (tc["avgPrice"] as number)
      : null;
  const takerEstFeeUsd =
    tc !== null && tc !== undefined && typeof tc["estFeeUsd"] === "number"
      ? (tc["estFeeUsd"] as number)
      : null;

  return {
    asset: asset as Asset,
    side: side as LeadingSide,
    limitPrice,
    sharesIfFilled,
    canonicalFilledShares: numOr(raw["canonicalFilledShares"], 0),
    canonicalCostUsd: numOr(raw["canonicalCostUsd"], 0),
    touchFilledAtMs: numOrNull(raw["touchFilledAtMs"]),
    queueAheadShares: numOrNull(raw["queueAheadShares"]),
    windowStartMs: numOr(raw["windowStartMs"], 0),
    windowEndMs: numOr(raw["windowEndMs"], 0),
    placedAtMs: numOr(raw["placedAtMs"], 0),
    remainingMin: numOrNull(raw["remaining"]),
    distanceBp: numOrNull(raw["distanceBp"]),
    modelProbability: numOrNull(raw["modelProbability"]),
    edge: numOrNull(raw["edge"]),
    regimeAlgoLabel,
    officialOutcome,
    proxyOutcome:
      raw["proxyOutcome"] === "up" || raw["proxyOutcome"] === "down"
        ? (raw["proxyOutcome"] as LeadingSide)
        : null,
    takerBestAskFillSize,
    takerBestAskAvgPrice,
    takerEstFeeUsd,
    signedDistanceBp:
      ept !== null && ept !== undefined
        ? numOrNull(ept["signedDistanceBp"])
        : null,
    entry5sDeltaBp: lb5 ? numOrNull(lb5["deltaBp"]) : null,
    entry15sDeltaBp: lb15 ? numOrNull(lb15["deltaBp"]) : null,
    entry30sDeltaBp: lb30 ? numOrNull(lb30["deltaBp"]) : null,
    entry60sDeltaBp: lb60 ? numOrNull(lb60["deltaBp"]) : null,
    preEntry30sPriceDelta: pmt30 ? numOrNull(pmt30["priceDelta"]) : null,
    preEntry30sBelowLimit: pmt30 ? numOrNull(pmt30["belowLimitTradeCount"]) : null,
    preEntry30sAtOrBelow: pmt30 ? numOrNull(pmt30["atOrBelowLimitTradeCount"]) : null,
    preEntry30sTradeCount: pmt30 ? numOrNull(pmt30["tradeCount"]) : null,
    preEntry15sBelowLimit: pmt15 ? numOrNull(pmt15["belowLimitTradeCount"]) : null,
    chosenSpread:
      ebt !== null && ebt !== undefined ? numOrNull(ebt["chosenSpread"]) : null,
    oppositeSpread:
      ebt !== null && ebt !== undefined ? numOrNull(ebt["oppositeSpread"]) : null,
    chosenAskSizeAtBestAsk:
      ebt !== null && ebt !== undefined
        ? numOrNull(ebt["chosenAskSizeAtBestAsk"])
        : null,
  };
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function applyFilter({
  orders,
  filter,
}: {
  readonly orders: readonly ReplayOrder[];
  readonly filter: FilterSpec;
}): readonly ReplayOrder[] {
  return orders.filter((o) => {
    if (filter.assets !== undefined && !filter.assets.includes(o.asset))
      return false;
    if (
      filter.excludeAssets !== undefined &&
      filter.excludeAssets.includes(o.asset)
    )
      return false;
    if (
      filter.minEdge !== undefined &&
      (o.edge === null || o.edge < filter.minEdge)
    )
      return false;
    if (
      filter.maxEdge !== undefined &&
      o.edge !== null &&
      o.edge > filter.maxEdge
    )
      return false;
    if (
      filter.minProb !== undefined &&
      (o.modelProbability === null || o.modelProbability < filter.minProb)
    )
      return false;
    if (
      filter.maxProb !== undefined &&
      o.modelProbability !== null &&
      o.modelProbability > filter.maxProb
    )
      return false;
    if (filter.sides !== undefined && !filter.sides.includes(o.side))
      return false;
    if (
      filter.minRemainingMin !== undefined &&
      (o.remainingMin === null || o.remainingMin < filter.minRemainingMin)
    )
      return false;
    if (
      filter.maxRemainingMin !== undefined &&
      o.remainingMin !== null &&
      o.remainingMin > filter.maxRemainingMin
    )
      return false;
    if (
      filter.minQueueAheadShares !== undefined &&
      (o.queueAheadShares === null ||
        o.queueAheadShares < filter.minQueueAheadShares)
    )
      return false;
    if (
      filter.maxLimitPrice !== undefined &&
      o.limitPrice > filter.maxLimitPrice
    )
      return false;
    if (
      filter.minLimitPrice !== undefined &&
      o.limitPrice < filter.minLimitPrice
    )
      return false;
    if (
      filter.maxDistanceBp !== undefined &&
      o.distanceBp !== null &&
      Math.abs(o.distanceBp) > filter.maxDistanceBp
    )
      return false;
    if (
      filter.regimeIncludes !== undefined &&
      o.regimeAlgoLabel !== null &&
      !filter.regimeIncludes.some((r) => o.regimeAlgoLabel!.includes(r))
    )
      return false;
    if (
      filter.regimeExcludes !== undefined &&
      o.regimeAlgoLabel !== null &&
      filter.regimeExcludes.some((r) => o.regimeAlgoLabel!.includes(r))
    )
      return false;
    if (
      filter.maxQueueAheadShares !== undefined &&
      o.queueAheadShares !== null &&
      o.queueAheadShares > filter.maxQueueAheadShares
    )
      return false;
    if (filter.minSignedDistanceBp !== undefined) {
      if (o.signedDistanceBp === null) return false;
      if (o.signedDistanceBp < filter.minSignedDistanceBp) return false;
    }
    if (filter.maxSignedDistanceBp !== undefined) {
      if (o.signedDistanceBp === null) return false;
      if (o.signedDistanceBp > filter.maxSignedDistanceBp) return false;
    }
    if (
      filter.minSideAlignedMomentumBp !== undefined ||
      filter.maxSideAlignedMomentumBp !== undefined
    ) {
      if (o.entry30sDeltaBp === null) return false;
      const m =
        o.side === "down" ? -o.entry30sDeltaBp : o.entry30sDeltaBp;
      if (
        filter.minSideAlignedMomentumBp !== undefined &&
        m < filter.minSideAlignedMomentumBp
      )
        return false;
      if (
        filter.maxSideAlignedMomentumBp !== undefined &&
        m > filter.maxSideAlignedMomentumBp
      )
        return false;
    }
    if (filter.minSideAlignedMomentum60sBp !== undefined) {
      if (o.entry60sDeltaBp === null) return false;
      const m =
        o.side === "down" ? -o.entry60sDeltaBp : o.entry60sDeltaBp;
      if (m < filter.minSideAlignedMomentum60sBp) return false;
    }
    if (
      filter.minTrendConfirmBp !== undefined ||
      filter.maxTrendConfirmBp !== undefined
    ) {
      if (o.signedDistanceBp === null) return false;
      const trendConfirm =
        o.side === "down" ? -o.signedDistanceBp : o.signedDistanceBp;
      if (
        filter.minTrendConfirmBp !== undefined &&
        trendConfirm < filter.minTrendConfirmBp
      )
        return false;
      if (
        filter.maxTrendConfirmBp !== undefined &&
        trendConfirm > filter.maxTrendConfirmBp
      )
        return false;
    }
    if (filter.minPreEntry30sFavorableDelta !== undefined) {
      // For "up" bets: favorable = price moved up (positive priceDelta).
      // For "down" bets: favorable = price moved down (negative priceDelta
      // → flip sign).
      const raw = o.preEntry30sPriceDelta;
      if (raw === null) return false;
      const signed = o.side === "up" ? raw : -raw;
      if (signed < filter.minPreEntry30sFavorableDelta) return false;
    }
    if (filter.maxPreEntry30sBelowLimit !== undefined) {
      if (o.preEntry30sBelowLimit === null) return false;
      if (o.preEntry30sBelowLimit > filter.maxPreEntry30sBelowLimit)
        return false;
    }
    if (filter.minPreEntry30sTradeCount !== undefined) {
      if (o.preEntry30sTradeCount === null) return false;
      if (o.preEntry30sTradeCount < filter.minPreEntry30sTradeCount)
        return false;
    }
    if (filter.maxChosenSpread !== undefined) {
      if (o.chosenSpread === null) return false;
      if (o.chosenSpread > filter.maxChosenSpread) return false;
    }
    if (filter.maxOppositeSpread !== undefined) {
      if (o.oppositeSpread === null) return false;
      if (o.oppositeSpread > filter.maxOppositeSpread) return false;
    }
    if (filter.minChosenAskSizeAtBestAsk !== undefined) {
      if (o.chosenAskSizeAtBestAsk === null) return false;
      if (o.chosenAskSizeAtBestAsk < filter.minChosenAskSizeAtBestAsk)
        return false;
    }
    return true;
  });
}

type FillSelector = (o: ReplayOrder) => number; // shares filled, 0 if none

function computeLens({
  orders,
  selectShares,
}: {
  readonly orders: readonly ReplayOrder[];
  readonly selectShares: FillSelector;
}): LensMetrics {
  let filled = 0;
  let wins = 0;
  let pnl = 0;
  let edgeSum = 0;
  let edgeN = 0;
  let limitSum = 0;
  let queueSum = 0;
  let queueN = 0;
  for (const o of orders) {
    if (o.edge !== null) {
      edgeSum += o.edge;
      edgeN += 1;
    }
    limitSum += o.limitPrice;
    if (o.queueAheadShares !== null) {
      queueSum += o.queueAheadShares;
      queueN += 1;
    }
    const shares = selectShares(o);
    if (shares <= 0) continue;
    filled += 1;
    const won =
      o.officialOutcome !== null && o.side === o.officialOutcome;
    if (won) wins += 1;
    const cost = shares * o.limitPrice;
    pnl += (won ? shares : 0) - cost;
  }
  return {
    orderCount: orders.length,
    filledCount: filled,
    fillRate: orders.length === 0 ? 0 : filled / orders.length,
    winRate: filled === 0 ? null : wins / filled,
    pnlUsd: pnl,
    pnlPerOrderUsd: orders.length === 0 ? 0 : pnl / orders.length,
    pnlPerFilledUsd: filled === 0 ? null : pnl / filled,
    avgEdge: edgeN === 0 ? null : edgeSum / edgeN,
    avgLimit: orders.length === 0 ? null : limitSum / orders.length,
    avgQueue: queueN === 0 ? null : queueSum / queueN,
  };
}

function evaluate({
  orders,
  filter,
  label,
}: {
  readonly orders: readonly ReplayOrder[];
  readonly filter: FilterSpec;
  readonly label: string;
}): SweepResult {
  const filtered = applyFilter({ orders, filter });
  return {
    label,
    canonical: computeLens({
      orders: filtered,
      selectShares: (o) => o.canonicalFilledShares,
    }),
    touch: computeLens({
      orders: filtered,
      selectShares: (o) =>
        o.touchFilledAtMs === null ? 0 : o.sharesIfFilled,
    }),
    allFilled: computeLens({
      orders: filtered,
      selectShares: (o) => o.sharesIfFilled,
    }),
  };
}

function fmtUsd(n: number): string {
  const sign = n >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(n).toFixed(2).padStart(8)}`;
}

function fmtPct(n: number | null): string {
  return n === null ? "  -- " : `${(n * 100).toFixed(1).padStart(5)}%`;
}

function printResult(r: SweepResult): void {
  const c = r.canonical;
  const a = r.allFilled;
  const t = r.touch;
  console.log(
    `${r.label.padEnd(38)} | n=${String(c.orderCount).padStart(4)} fill=${String(c.filledCount).padStart(4)}/${String(c.orderCount).padStart(4)} (${fmtPct(c.fillRate)}) | canon ${fmtUsd(c.pnlUsd)} (win ${fmtPct(c.winRate)}) | touch ${fmtUsd(t.pnlUsd)} | all-fill ${fmtUsd(a.pnlUsd)}`,
  );
}

function sweepMinEdge(orders: readonly ReplayOrder[]): void {
  console.log("\n=== min-edge sweep ===");
  for (const minEdge of [0.05, 0.06, 0.07, 0.08, 0.10, 0.12, 0.15, 0.20, 0.25, 0.30]) {
    printResult(
      evaluate({
        orders,
        filter: { minEdge },
        label: `minEdge>=${minEdge.toFixed(2)}`,
      }),
    );
  }
}

function sweepAsset(orders: readonly ReplayOrder[]): void {
  console.log("\n=== per-asset (min-edge=0.05 baseline) ===");
  const allAssets: Asset[] = ["btc", "eth", "sol", "xrp", "doge"];
  for (const asset of allAssets) {
    printResult(
      evaluate({
        orders,
        filter: { assets: [asset] },
        label: `asset=${asset}`,
      }),
    );
  }
  // per-asset at higher edge gates
  for (const minEdge of [0.10, 0.15]) {
    console.log(`\n  -- per-asset @ minEdge>=${minEdge.toFixed(2)} --`);
    for (const asset of allAssets) {
      printResult(
        evaluate({
          orders,
          filter: { assets: [asset], minEdge },
          label: `asset=${asset}`,
        }),
      );
    }
  }
}

function sweepRemaining(orders: readonly ReplayOrder[]): void {
  console.log("\n=== per-remaining-minute (min-edge=0.05) ===");
  for (const r of [1, 2, 3, 4, 5]) {
    printResult(
      evaluate({
        orders,
        filter: { minRemainingMin: r, maxRemainingMin: r },
        label: `remaining=${r}min`,
      }),
    );
  }
}

function sweepSide(orders: readonly ReplayOrder[]): void {
  console.log("\n=== per-side ===");
  for (const side of ["up", "down"] as const) {
    printResult(
      evaluate({
        orders,
        filter: { sides: [side] },
        label: `side=${side}`,
      }),
    );
  }
}

function sweepQueue(orders: readonly ReplayOrder[]): void {
  console.log("\n=== queue-ahead-shares floor ===");
  for (const q of [0, 25, 50, 100, 200, 500, 1000]) {
    printResult(
      evaluate({
        orders,
        filter: { minQueueAheadShares: q },
        label: `queueAhead>=${q}`,
      }),
    );
  }
}

function sweepRegime(orders: readonly ReplayOrder[]): void {
  console.log("\n=== per-regime-algo ===");
  const regimes = new Map<string, number>();
  for (const o of orders) {
    if (o.regimeAlgoLabel !== null) {
      regimes.set(o.regimeAlgoLabel, (regimes.get(o.regimeAlgoLabel) ?? 0) + 1);
    }
  }
  const sorted = [...regimes.entries()].sort((a, b) => b[1] - a[1]);
  for (const [regime, count] of sorted) {
    if (count < 10) continue;
    printResult(
      evaluate({
        orders,
        filter: { regimeIncludes: [regime] },
        label: `regime=${regime}`,
      }),
    );
  }
}

function sweepLimitPrice(orders: readonly ReplayOrder[]): void {
  console.log("\n=== per-limit-price-bucket ===");
  for (const [lo, hi] of [
    [0.0, 0.4],
    [0.4, 0.5],
    [0.5, 0.55],
    [0.55, 0.6],
    [0.6, 0.65],
    [0.65, 0.7],
    [0.7, 0.8],
    [0.8, 1.0],
  ] as const) {
    printResult(
      evaluate({
        orders,
        filter: { minLimitPrice: lo, maxLimitPrice: hi },
        label: `limit∈[${lo.toFixed(2)},${hi.toFixed(2)})`,
      }),
    );
  }
}

function sweepSignedDistance(orders: readonly ReplayOrder[]): void {
  console.log("\n=== signed distance bp (where price is vs line in our direction) ===");
  for (const [lo, hi] of [
    [-Infinity, -10],
    [-10, -5],
    [-5, -2],
    [-2, 0],
    [0, 2],
    [2, 5],
    [5, 10],
    [10, Infinity],
  ] as const) {
    const filter: FilterSpec = {
      ...(Number.isFinite(lo) ? { minSignedDistanceBp: lo as number } : {}),
      ...(Number.isFinite(hi) ? { maxSignedDistanceBp: hi as number } : {}),
    };
    printResult(
      evaluate({
        orders,
        filter,
        label: `signedDistBp∈[${lo},${hi})`,
      }),
    );
  }
}

function sweepPreEntryFavorable(orders: readonly ReplayOrder[]): void {
  console.log("\n=== pre-entry 30s favorable delta (positive=trend in our favor) ===");
  for (const minDelta of [-Infinity, -2, -1, -0.5, 0, 0.5, 1, 2, 5]) {
    const filter: FilterSpec = Number.isFinite(minDelta)
      ? { minPreEntry30sFavorableDelta: minDelta as number }
      : {};
    printResult(
      evaluate({
        orders,
        filter,
        label: `minFavorableDelta>=${minDelta}`,
      }),
    );
  }
}

function sweepMaxBelowLimit(orders: readonly ReplayOrder[]): void {
  console.log("\n=== max pre-entry 30s below-limit trades (cap adverse pressure) ===");
  for (const max of [Infinity, 50, 30, 20, 10, 5, 2, 0]) {
    const filter: FilterSpec = Number.isFinite(max)
      ? { maxPreEntry30sBelowLimit: max as number }
      : {};
    printResult(
      evaluate({
        orders,
        filter,
        label: `belowLimit<=${max}`,
      }),
    );
  }
}

function sweepBookGates(orders: readonly ReplayOrder[]): void {
  console.log("\n=== chosen-side ask size (bigger = more sellers ready to hit our limit) ===");
  for (const min of [0, 50, 100, 200, 500, 1000]) {
    printResult(
      evaluate({
        orders,
        filter: { minChosenAskSizeAtBestAsk: min },
        label: `askSize>=${min}`,
      }),
    );
  }
}

function sweepEntryMomentum(orders: readonly ReplayOrder[]): void {
  console.log("\n=== entry 30s deltaBp (recent price momentum, signed by our side) ===");
  // The deltaBp is RAW (current - past); positive when up.
  // We don't have a 'side' marker on it directly, so evaluate raw buckets.
  for (const [lo, hi] of [
    [-Infinity, -5],
    [-5, -2],
    [-2, -0.5],
    [-0.5, 0.5],
    [0.5, 2],
    [2, 5],
    [5, Infinity],
  ] as const) {
    const matched = orders.filter((o) => {
      const v = o.entry30sDeltaBp;
      if (v === null) return false;
      const lov = Number.isFinite(lo) ? (lo as number) : -Infinity;
      const hiv = Number.isFinite(hi) ? (hi as number) : Infinity;
      return v >= lov && v < hiv;
    });
    const result = evaluate({
      orders: matched,
      filter: {},
      label: `entry30sDeltaBp∈[${lo},${hi})`,
    });
    printResult(result);
  }
}

function splitByTime({
  orders,
  splits,
}: {
  readonly orders: readonly ReplayOrder[];
  readonly splits: number;
}): void {
  if (orders.length === 0) return;
  const sortedByPlaced = [...orders].sort((a, b) => a.placedAtMs - b.placedAtMs);
  const minMs = sortedByPlaced[0]!.placedAtMs;
  const maxMs = sortedByPlaced[sortedByPlaced.length - 1]!.placedAtMs;
  const span = maxMs - minMs;
  const bucket = Math.ceil(span / splits);
  console.log(`\n=== time-split (${splits} buckets, ${(span / 3600000).toFixed(1)}h span) ===`);
  for (let i = 0; i < splits; i += 1) {
    const lo = minMs + i * bucket;
    const hi = i === splits - 1 ? maxMs + 1 : minMs + (i + 1) * bucket;
    const bucketOrders = sortedByPlaced.filter(
      (o) => o.placedAtMs >= lo && o.placedAtMs < hi,
    );
    const result = evaluate({
      orders: bucketOrders,
      filter: {},
      label: `bucket-${i}@${new Date(lo).toISOString().slice(11, 16)}`,
    });
    printResult(result);
  }
}

function summarizeBaseline(orders: readonly ReplayOrder[]): void {
  console.log("\n=== baseline (no filter) ===");
  printResult(
    evaluate({
      orders,
      filter: {},
      label: "baseline",
    }),
  );
}

const path = process.argv[2];
const sweep = process.argv[3] ?? "all";
const explicitFilter = process.argv[3] === "--filter" ? process.argv[4] : null;
if (path === undefined) {
  console.error("usage: bun src/bin/research/sweepReplay.ts <jsonl-path> [sweep|--filter '<json>']");
  process.exit(1);
}
const resolved = resolve(path);
const orders = loadOrders({ path: resolved });
console.log(`loaded ${orders.length} orders from ${resolved}`);

type UnionFilter = { readonly any: readonly FilterSpec[] };

function applyUnion({
  orders,
  filters,
}: {
  readonly orders: readonly ReplayOrder[];
  readonly filters: readonly FilterSpec[];
}): readonly ReplayOrder[] {
  const seen = new Set<ReplayOrder>();
  for (const f of filters) {
    for (const o of applyFilter({ orders, filter: f })) seen.add(o);
  }
  return [...seen];
}

if (explicitFilter !== null) {
  const parsed = JSON.parse(explicitFilter) as
    | FilterSpec
    | UnionFilter
    | { readonly union: readonly FilterSpec[] };
  let result: SweepResult;
  let filtered: readonly ReplayOrder[];
  if ("any" in parsed && Array.isArray((parsed as UnionFilter).any)) {
    filtered = applyUnion({ orders, filters: (parsed as UnionFilter).any });
    result = {
      label: "union",
      canonical: computeLens({
        orders: filtered,
        selectShares: (o) => o.canonicalFilledShares,
      }),
      touch: computeLens({
        orders: filtered,
        selectShares: (o) =>
          o.touchFilledAtMs === null ? 0 : o.sharesIfFilled,
      }),
      allFilled: computeLens({
        orders: filtered,
        selectShares: (o) => o.sharesIfFilled,
      }),
    };
  } else {
    const filter = parsed as FilterSpec;
    filtered = applyFilter({ orders, filter });
    result = evaluate({ orders, filter, label: "filter" });
  }
  printResult(result);
  // Also show stability across time-buckets (4 chunks)
  splitByTime({ orders: filtered, splits: 4 });
} else {
  summarizeBaseline(orders);
  if (sweep === "all" || sweep === "min-edge") sweepMinEdge(orders);
  if (sweep === "all" || sweep === "asset") sweepAsset(orders);
  if (sweep === "all" || sweep === "remaining") sweepRemaining(orders);
  if (sweep === "all" || sweep === "side") sweepSide(orders);
  if (sweep === "all" || sweep === "queue") sweepQueue(orders);
  if (sweep === "all" || sweep === "regime") sweepRegime(orders);
  if (sweep === "all" || sweep === "limit") sweepLimitPrice(orders);
  if (sweep === "all" || sweep === "signed-distance") sweepSignedDistance(orders);
  if (sweep === "all" || sweep === "favorable") sweepPreEntryFavorable(orders);
  if (sweep === "all" || sweep === "below-limit") sweepMaxBelowLimit(orders);
  if (sweep === "all" || sweep === "book") sweepBookGates(orders);
  if (sweep === "all" || sweep === "momentum") sweepEntryMomentum(orders);
}
