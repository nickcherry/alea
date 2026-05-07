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
 *   bun src/bin/research/sweepReplay.ts <jsonl-path> [--sweep min-edge|asset|regime|remaining|queue|side|hour|us|combos]
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
  readonly takerCostUsd: number | null;
  readonly takerEstFeeUsd: number | null;
  // telemetry-derived features used for filtering
  readonly chosenBestAsk: number | null;
  readonly chosenBestBid: number | null;
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
  readonly chosenAskDepthRatio: number | null;
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
  // Time-of-day gate (UTC hours, inclusive on both ends)
  readonly hoursUtc?: readonly number[];
  readonly excludeHoursUtc?: readonly number[];
  readonly excludeAssetHoursUtc?: readonly string[];
  readonly minSecondsIntoWindow?: number;
  readonly maxSecondsIntoWindow?: number;
  readonly minChosenAskDepthRatio?: number;
  readonly maxChosenAskDepthRatio?: number;
  readonly maxTakerAskPrice?: number;
  readonly minTakerAskPrice?: number;
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
  readonly taker?: LensMetrics;
  readonly hybrid?: LensMetrics;
};

/**
 * Polymarket CLOB taker fee, applied as
 *   shares × (feeRateBps / 10_000) × price × (1 − price)
 * Default 720 bps matches the value documented in
 * computePolymarketFeeUsd test fixtures and the live placement code's
 * worst-case assumption. Maker side is 0% per
 * scanLifetimePnl.ts:187 (`MAKER ? 0 : fee_rate_bps`).
 */
const TAKER_FEE_BPS_DEFAULT = 720;

function takerFeeUsd({
  shares,
  price,
  feeBps = TAKER_FEE_BPS_DEFAULT,
}: {
  readonly shares: number;
  readonly price: number;
  readonly feeBps?: number;
}): number {
  if (shares <= 0 || price <= 0 || price >= 1 || feeBps <= 0) {
    return 0;
  }
  return shares * (feeBps / 10_000) * price * (1 - price);
}

function loadOrders({
  path,
}: {
  readonly path: string;
}): readonly ReplayOrder[] {
  const text = readFileSync(path, "utf8");
  const out: ReplayOrder[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      continue;
    }
    const obj = parsed as Record<string, unknown>;
    if (obj["type"] !== "window_finalized") {
      continue;
    }
    const orders = obj["orders"];
    if (!Array.isArray(orders)) {
      continue;
    }
    for (const o of orders) {
      if (typeof o !== "object" || o === null) {
        continue;
      }
      const order = parseOrder(o as Record<string, unknown>);
      if (order !== null) {
        out.push(order);
      }
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
  if (officialOutcome === null) {
    return null;
  }

  const regimeRaw = raw["regime"];
  const regimeAlgoLabel = typeof regimeRaw === "string" ? regimeRaw : null;

  const ept = raw["entryPriceTelemetry"] as
    | Record<string, unknown>
    | null
    | undefined;
  const eptLookbacks = (
    ept !== null && ept !== undefined
      ? ((ept["lookbacks"] as unknown[] | undefined) ?? [])
      : []
  ) as Array<Record<string, unknown>>;
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
  const pmtLookbacks = (
    pmt !== null && pmt !== undefined
      ? ((pmt["lookbacks"] as unknown[] | undefined) ?? [])
      : []
  ) as Array<Record<string, unknown>>;
  const pmt15 = pmtLookbacks.find((lb) => lb["lookbackMs"] === 15000);
  const pmt30 = pmtLookbacks.find((lb) => lb["lookbackMs"] === 30000);

  const tc = raw["takerCounterfactual"] as
    | Record<string, unknown>
    | null
    | undefined;
  const takerBestAskFillSize =
    tc !== null && tc !== undefined && typeof tc["fillSize"] === "number"
      ? tc["fillSize"]
      : tc !== null &&
          tc !== undefined &&
          typeof tc["sharesIfFilled"] === "number"
        ? tc["sharesIfFilled"]
        : null;
  const takerBestAskAvgPrice =
    tc !== null && tc !== undefined && typeof tc["avgPrice"] === "number"
      ? tc["avgPrice"]
      : tc !== null && tc !== undefined && typeof tc["askPrice"] === "number"
        ? tc["askPrice"]
        : null;
  const takerCostUsd =
    tc !== null && tc !== undefined && typeof tc["costUsd"] === "number"
      ? tc["costUsd"]
      : null;
  const takerEstFeeUsd =
    tc !== null && tc !== undefined && typeof tc["estFeeUsd"] === "number"
      ? tc["estFeeUsd"]
      : tc !== null &&
          tc !== undefined &&
          typeof tc["estimatedFeeUsd"] === "number"
        ? tc["estimatedFeeUsd"]
        : null;
  const chosenBestAsk =
    ebt !== null && ebt !== undefined ? numOrNull(ebt["chosenBestAsk"]) : null;
  const chosenAskSizeAtBestAsk =
    ebt !== null && ebt !== undefined
      ? numOrNull(ebt["chosenAskSizeAtBestAsk"])
      : null;
  const chosenAskDepthRatio =
    chosenAskSizeAtBestAsk === null ||
    takerBestAskFillSize === null ||
    takerBestAskFillSize <= 0
      ? null
      : chosenAskSizeAtBestAsk / takerBestAskFillSize;

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
        ? raw["proxyOutcome"]
        : null,
    takerBestAskFillSize,
    takerBestAskAvgPrice,
    takerCostUsd,
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
    preEntry30sBelowLimit: pmt30
      ? numOrNull(pmt30["belowLimitTradeCount"])
      : null,
    preEntry30sAtOrBelow: pmt30
      ? numOrNull(pmt30["atOrBelowLimitTradeCount"])
      : null,
    preEntry30sTradeCount: pmt30 ? numOrNull(pmt30["tradeCount"]) : null,
    preEntry15sBelowLimit: pmt15
      ? numOrNull(pmt15["belowLimitTradeCount"])
      : null,
    chosenBestAsk,
    chosenBestBid:
      ebt !== null && ebt !== undefined
        ? numOrNull(ebt["chosenBestBid"])
        : null,
    chosenSpread:
      ebt !== null && ebt !== undefined ? numOrNull(ebt["chosenSpread"]) : null,
    oppositeSpread:
      ebt !== null && ebt !== undefined
        ? numOrNull(ebt["oppositeSpread"])
        : null,
    chosenAskSizeAtBestAsk,
    chosenAskDepthRatio,
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
    if (filter.assets !== undefined && !filter.assets.includes(o.asset)) {
      return false;
    }
    if (
      filter.excludeAssets !== undefined &&
      filter.excludeAssets.includes(o.asset)
    ) {
      return false;
    }
    if (
      filter.minEdge !== undefined &&
      (o.edge === null || o.edge < filter.minEdge)
    ) {
      return false;
    }
    if (
      filter.maxEdge !== undefined &&
      o.edge !== null &&
      o.edge > filter.maxEdge
    ) {
      return false;
    }
    if (
      filter.minProb !== undefined &&
      (o.modelProbability === null || o.modelProbability < filter.minProb)
    ) {
      return false;
    }
    if (
      filter.maxProb !== undefined &&
      o.modelProbability !== null &&
      o.modelProbability > filter.maxProb
    ) {
      return false;
    }
    if (filter.sides !== undefined && !filter.sides.includes(o.side)) {
      return false;
    }
    if (
      filter.minRemainingMin !== undefined &&
      (o.remainingMin === null || o.remainingMin < filter.minRemainingMin)
    ) {
      return false;
    }
    if (
      filter.maxRemainingMin !== undefined &&
      o.remainingMin !== null &&
      o.remainingMin > filter.maxRemainingMin
    ) {
      return false;
    }
    if (
      filter.minQueueAheadShares !== undefined &&
      (o.queueAheadShares === null ||
        o.queueAheadShares < filter.minQueueAheadShares)
    ) {
      return false;
    }
    if (
      filter.maxLimitPrice !== undefined &&
      o.limitPrice > filter.maxLimitPrice
    ) {
      return false;
    }
    if (
      filter.minLimitPrice !== undefined &&
      o.limitPrice < filter.minLimitPrice
    ) {
      return false;
    }
    if (
      filter.maxDistanceBp !== undefined &&
      o.distanceBp !== null &&
      Math.abs(o.distanceBp) > filter.maxDistanceBp
    ) {
      return false;
    }
    if (
      filter.regimeIncludes !== undefined &&
      o.regimeAlgoLabel !== null &&
      !filter.regimeIncludes.some((r) => o.regimeAlgoLabel!.includes(r))
    ) {
      return false;
    }
    if (
      filter.regimeExcludes !== undefined &&
      o.regimeAlgoLabel !== null &&
      filter.regimeExcludes.some((r) => o.regimeAlgoLabel!.includes(r))
    ) {
      return false;
    }
    if (
      filter.maxQueueAheadShares !== undefined &&
      o.queueAheadShares !== null &&
      o.queueAheadShares > filter.maxQueueAheadShares
    ) {
      return false;
    }
    if (filter.minSignedDistanceBp !== undefined) {
      if (o.signedDistanceBp === null) {
        return false;
      }
      if (o.signedDistanceBp < filter.minSignedDistanceBp) {
        return false;
      }
    }
    if (filter.maxSignedDistanceBp !== undefined) {
      if (o.signedDistanceBp === null) {
        return false;
      }
      if (o.signedDistanceBp > filter.maxSignedDistanceBp) {
        return false;
      }
    }
    if (
      filter.minSideAlignedMomentumBp !== undefined ||
      filter.maxSideAlignedMomentumBp !== undefined
    ) {
      if (o.entry30sDeltaBp === null) {
        return false;
      }
      const m = o.side === "down" ? -o.entry30sDeltaBp : o.entry30sDeltaBp;
      if (
        filter.minSideAlignedMomentumBp !== undefined &&
        m < filter.minSideAlignedMomentumBp
      ) {
        return false;
      }
      if (
        filter.maxSideAlignedMomentumBp !== undefined &&
        m > filter.maxSideAlignedMomentumBp
      ) {
        return false;
      }
    }
    if (filter.minSideAlignedMomentum60sBp !== undefined) {
      if (o.entry60sDeltaBp === null) {
        return false;
      }
      const m = o.side === "down" ? -o.entry60sDeltaBp : o.entry60sDeltaBp;
      if (m < filter.minSideAlignedMomentum60sBp) {
        return false;
      }
    }
    if (
      filter.minTrendConfirmBp !== undefined ||
      filter.maxTrendConfirmBp !== undefined
    ) {
      if (o.signedDistanceBp === null) {
        return false;
      }
      const trendConfirm =
        o.side === "down" ? -o.signedDistanceBp : o.signedDistanceBp;
      if (
        filter.minTrendConfirmBp !== undefined &&
        trendConfirm < filter.minTrendConfirmBp
      ) {
        return false;
      }
      if (
        filter.maxTrendConfirmBp !== undefined &&
        trendConfirm > filter.maxTrendConfirmBp
      ) {
        return false;
      }
    }
    if (filter.minPreEntry30sFavorableDelta !== undefined) {
      // For "up" bets: favorable = price moved up (positive priceDelta).
      // For "down" bets: favorable = price moved down (negative priceDelta
      // → flip sign).
      const raw = o.preEntry30sPriceDelta;
      if (raw === null) {
        return false;
      }
      const signed = o.side === "up" ? raw : -raw;
      if (signed < filter.minPreEntry30sFavorableDelta) {
        return false;
      }
    }
    if (filter.maxPreEntry30sBelowLimit !== undefined) {
      if (o.preEntry30sBelowLimit === null) {
        return false;
      }
      if (o.preEntry30sBelowLimit > filter.maxPreEntry30sBelowLimit) {
        return false;
      }
    }
    if (filter.minPreEntry30sTradeCount !== undefined) {
      if (o.preEntry30sTradeCount === null) {
        return false;
      }
      if (o.preEntry30sTradeCount < filter.minPreEntry30sTradeCount) {
        return false;
      }
    }
    if (filter.maxChosenSpread !== undefined) {
      if (o.chosenSpread === null) {
        return false;
      }
      if (o.chosenSpread > filter.maxChosenSpread) {
        return false;
      }
    }
    if (filter.maxOppositeSpread !== undefined) {
      if (o.oppositeSpread === null) {
        return false;
      }
      if (o.oppositeSpread > filter.maxOppositeSpread) {
        return false;
      }
    }
    if (filter.minChosenAskSizeAtBestAsk !== undefined) {
      if (o.chosenAskSizeAtBestAsk === null) {
        return false;
      }
      if (o.chosenAskSizeAtBestAsk < filter.minChosenAskSizeAtBestAsk) {
        return false;
      }
    }
    if (
      filter.hoursUtc !== undefined ||
      filter.excludeHoursUtc !== undefined ||
      filter.excludeAssetHoursUtc !== undefined
    ) {
      const hr = new Date(o.placedAtMs).getUTCHours();
      if (filter.hoursUtc !== undefined && !filter.hoursUtc.includes(hr)) {
        return false;
      }
      if (
        filter.excludeHoursUtc !== undefined &&
        filter.excludeHoursUtc.includes(hr)
      ) {
        return false;
      }
      if (
        filter.excludeAssetHoursUtc !== undefined &&
        filter.excludeAssetHoursUtc.includes(`${o.asset}:${hr}`)
      ) {
        return false;
      }
    }
    if (
      filter.minSecondsIntoWindow !== undefined ||
      filter.maxSecondsIntoWindow !== undefined
    ) {
      const secondsIntoWindow = (o.placedAtMs - o.windowStartMs) / 1000;
      if (
        filter.minSecondsIntoWindow !== undefined &&
        secondsIntoWindow < filter.minSecondsIntoWindow
      ) {
        return false;
      }
      if (
        filter.maxSecondsIntoWindow !== undefined &&
        secondsIntoWindow > filter.maxSecondsIntoWindow
      ) {
        return false;
      }
    }
    if (filter.minChosenAskDepthRatio !== undefined) {
      if (o.chosenAskDepthRatio === null) {
        return false;
      }
      if (o.chosenAskDepthRatio < filter.minChosenAskDepthRatio) {
        return false;
      }
    }
    if (filter.maxChosenAskDepthRatio !== undefined) {
      if (o.chosenAskDepthRatio === null) {
        return false;
      }
      if (o.chosenAskDepthRatio > filter.maxChosenAskDepthRatio) {
        return false;
      }
    }
    if (filter.maxTakerAskPrice !== undefined) {
      if (o.chosenBestAsk === null) {
        return false;
      }
      if (o.chosenBestAsk > filter.maxTakerAskPrice) {
        return false;
      }
    }
    if (filter.minTakerAskPrice !== undefined) {
      if (o.chosenBestAsk === null) {
        return false;
      }
      if (o.chosenBestAsk < filter.minTakerAskPrice) {
        return false;
      }
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
    if (shares <= 0) {
      continue;
    }
    filled += 1;
    const won = o.officialOutcome !== null && o.side === o.officialOutcome;
    if (won) {
      wins += 1;
    }
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

function computeTakerLens({
  orders,
  feeBps = TAKER_FEE_BPS_DEFAULT,
  stakeUsd = 20,
  slippageTicks = 0,
}: {
  readonly orders: readonly ReplayOrder[];
  readonly feeBps?: number;
  readonly stakeUsd?: number;
  /**
   * Simple level-2 slippage model: assume the avg fill price is
   * `bestAsk + slippageTicks * 0.01`. Use 0 for "fills entirely at
   * best ask" (optimistic), 0.5 for "half at best, half at next tick",
   * 1.0 for "all of need eats through to next level".
   *
   * Given the median best-ask depth at $20 stake is only 36% of need,
   * 0.5 is a reasonable conservative default.
   */
  readonly slippageTicks?: number;
}): LensMetrics {
  // Taker = pay best ask + slippage at entry.
  let filled = 0;
  let wins = 0;
  let pnl = 0;
  for (const o of orders) {
    const execution = takerExecution({
      order: o,
      stakeUsd,
      slippageTicks,
    });
    if (execution === null || o.officialOutcome === null) {
      continue;
    }
    filled += 1;
    const won = o.side === o.officialOutcome;
    if (won) {
      wins += 1;
    }
    const fee = takerFeeUsd({
      shares: execution.shares,
      price: execution.avgPrice,
      feeBps,
    });
    pnl += (won ? execution.shares : 0) - execution.costUsd - fee;
  }
  return {
    orderCount: orders.length,
    filledCount: filled,
    fillRate: orders.length === 0 ? 0 : filled / orders.length,
    winRate: filled === 0 ? null : wins / filled,
    pnlUsd: pnl,
    pnlPerOrderUsd: orders.length === 0 ? 0 : pnl / orders.length,
    pnlPerFilledUsd: filled === 0 ? null : pnl / filled,
    avgEdge: null,
    avgLimit: null,
    avgQueue: null,
  };
}

function takerExecution({
  order,
  stakeUsd,
  slippageTicks,
}: {
  readonly order: ReplayOrder;
  readonly stakeUsd: number;
  readonly slippageTicks: number;
}): {
  readonly shares: number;
  readonly avgPrice: number;
  readonly costUsd: number;
} | null {
  if (
    order.takerBestAskFillSize !== null &&
    order.takerBestAskFillSize > 0 &&
    order.takerBestAskAvgPrice !== null &&
    order.takerBestAskAvgPrice > 0 &&
    order.takerBestAskAvgPrice < 1
  ) {
    const avgPrice = Math.min(
      0.99,
      order.takerBestAskAvgPrice + slippageTicks * 0.01,
    );
    const baseCost =
      order.takerCostUsd ?? order.takerBestAskFillSize * order.takerBestAskAvgPrice;
    const extraSlippageCost =
      order.takerBestAskFillSize * Math.max(0, avgPrice - order.takerBestAskAvgPrice);
    return {
      shares: order.takerBestAskFillSize,
      avgPrice,
      costUsd: baseCost + extraSlippageCost,
    };
  }

  const baseAsk = order.chosenBestAsk ?? Math.min(0.99, order.limitPrice + 0.01);
  if (baseAsk <= 0 || baseAsk >= 1) {
    return null;
  }
  const avgPrice = Math.min(0.99, baseAsk + slippageTicks * 0.01);
  const shares = Math.floor((stakeUsd / avgPrice) * 100) / 100;
  if (shares <= 0) {
    return null;
  }
  return {
    shares,
    avgPrice,
    costUsd: shares * avgPrice,
  };
}

function computeHybridLens({
  orders,
  makerAssets,
  feeBps = TAKER_FEE_BPS_DEFAULT,
  stakeUsd = 20,
  slippageTicks = 0,
}: {
  readonly orders: readonly ReplayOrder[];
  readonly makerAssets: readonly Asset[];
  readonly feeBps?: number;
  readonly stakeUsd?: number;
  readonly slippageTicks?: number;
}): LensMetrics {
  let filled = 0;
  let wins = 0;
  let pnl = 0;
  for (const o of orders) {
    if (o.officialOutcome === null) {
      continue;
    }
    const won = o.side === o.officialOutcome;
    if (makerAssets.includes(o.asset)) {
      if (o.canonicalFilledShares <= 0) {
        continue;
      }
      filled += 1;
      if (won) {
        wins += 1;
      }
      pnl += (won ? o.canonicalFilledShares : 0) - o.canonicalCostUsd;
      continue;
    }

    const execution = takerExecution({
      order: o,
      stakeUsd,
      slippageTicks,
    });
    if (execution === null) {
      continue;
    }
    filled += 1;
    if (won) {
      wins += 1;
    }
    const fee = takerFeeUsd({
      shares: execution.shares,
      price: execution.avgPrice,
      feeBps,
    });
    pnl += (won ? execution.shares : 0) - execution.costUsd - fee;
  }
  return {
    orderCount: orders.length,
    filledCount: filled,
    fillRate: orders.length === 0 ? 0 : filled / orders.length,
    winRate: filled === 0 ? null : wins / filled,
    pnlUsd: pnl,
    pnlPerOrderUsd: orders.length === 0 ? 0 : pnl / orders.length,
    pnlPerFilledUsd: filled === 0 ? null : pnl / filled,
    avgEdge: null,
    avgLimit: null,
    avgQueue: null,
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
      selectShares: (o) => (o.touchFilledAtMs === null ? 0 : o.sharesIfFilled),
    }),
    allFilled: computeLens({
      orders: filtered,
      selectShares: (o) => o.sharesIfFilled,
    }),
    taker: computeTakerLens({ orders: filtered }),
    hybrid: computeHybridLens({ orders: filtered, makerAssets: ["doge"] }),
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
  const k = r.taker;
  const h = r.hybrid;
  console.log(
    `${r.label.padEnd(38)} | n=${String(c.orderCount).padStart(4)} fill=${String(c.filledCount).padStart(4)}/${String(c.orderCount).padStart(4)} (${fmtPct(c.fillRate)}) | canon ${fmtUsd(c.pnlUsd)} (win ${fmtPct(c.winRate)}) | touch ${fmtUsd(t.pnlUsd)} | all-fill ${fmtUsd(a.pnlUsd)}${k ? ` | taker@720bps ${fmtUsd(k.pnlUsd)} (win ${fmtPct(k.winRate)})` : ""}${h ? ` | hybrid(doge-maker) ${fmtUsd(h.pnlUsd)} (fill ${fmtPct(h.fillRate)}, win ${fmtPct(h.winRate)})` : ""}`,
  );
}

function printTakerFeeSweep({
  orders,
  label,
}: {
  readonly orders: readonly ReplayOrder[];
  readonly label: string;
}): void {
  const fees = [0, 100, 200, 400, 600, 720, 1000, 1500];
  console.log(`\n=== taker fee sensitivity for: ${label} ===`);
  for (const feeBps of fees) {
    const t = computeTakerLens({ orders, feeBps });
    console.log(
      `  feeBps=${String(feeBps).padStart(5)} | n=${String(t.orderCount).padStart(4)} | pnl ${fmtUsd(t.pnlUsd)} (win ${fmtPct(t.winRate)})`,
    );
  }
  console.log(`\n=== taker slippage sensitivity (720 bps fee) ===`);
  for (const slippageTicks of [0, 0.25, 0.5, 0.75, 1.0]) {
    const t = computeTakerLens({ orders, slippageTicks });
    console.log(
      `  slippage=${slippageTicks.toFixed(2)}tk | n=${String(t.orderCount).padStart(4)} | pnl ${fmtUsd(t.pnlUsd)} (win ${fmtPct(t.winRate)})`,
    );
  }
}

function printHybridFeeSweep({
  orders,
  label,
}: {
  readonly orders: readonly ReplayOrder[];
  readonly label: string;
}): void {
  const fees = [0, 100, 200, 400, 600, 720, 1000, 1500];
  console.log(`\n=== hybrid fee sensitivity for: ${label} ===`);
  for (const feeBps of fees) {
    const h = computeHybridLens({ orders, makerAssets: ["doge"], feeBps });
    console.log(
      `  feeBps=${String(feeBps).padStart(5)} | n=${String(h.orderCount).padStart(4)} | pnl ${fmtUsd(h.pnlUsd)} (fill ${fmtPct(h.fillRate)}, win ${fmtPct(h.winRate)})`,
    );
  }
  console.log(`\n=== hybrid slippage sensitivity (720 bps fee) ===`);
  for (const slippageTicks of [0, 0.25, 0.5, 0.75, 1.0]) {
    const h = computeHybridLens({
      orders,
      makerAssets: ["doge"],
      slippageTicks,
    });
    console.log(
      `  slippage=${slippageTicks.toFixed(2)}tk | n=${String(h.orderCount).padStart(4)} | pnl ${fmtUsd(h.pnlUsd)} (fill ${fmtPct(h.fillRate)}, win ${fmtPct(h.winRate)})`,
    );
  }
}

function sweepMinEdge(orders: readonly ReplayOrder[]): void {
  console.log("\n=== min-edge sweep ===");
  for (const minEdge of [
    0.05, 0.06, 0.07, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3,
  ]) {
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
  for (const minEdge of [0.1, 0.15]) {
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

function sweepHour(orders: readonly ReplayOrder[]): void {
  console.log("\n=== per UTC hour ===");
  for (let hour = 0; hour < 24; hour += 1) {
    printResult(
      evaluate({
        orders,
        filter: { hoursUtc: [hour] },
        label: `hour=${String(hour).padStart(2, "0")}Z`,
      }),
    );
  }
}

const US_HOURS_UTC = [16, 17, 18, 19, 20, 21, 22, 23] as const;

function withUsHours(filter: FilterSpec): FilterSpec {
  return { ...filter, hoursUtc: US_HOURS_UTC };
}

function sweepUsHours(orders: readonly ReplayOrder[]): void {
  console.log("\n=== US-hours competition sweep (16-23 UTC) ===");
  printResult(
    evaluate({
      orders,
      filter: withUsHours({ minEdge: 0.06 }),
      label: "us minEdge>=0.06",
    }),
  );

  console.log("\n  -- edge floors --");
  for (const minEdge of [0.06, 0.08, 0.1, 0.12, 0.15, 0.2]) {
    printResult(
      evaluate({
        orders,
        filter: withUsHours({ minEdge }),
        label: `us edge>=${minEdge.toFixed(2)}`,
      }),
    );
  }

  console.log("\n  -- per asset @ edge>=0.06 --");
  for (const asset of ["btc", "eth", "sol", "xrp", "doge"] as const) {
    printResult(
      evaluate({
        orders,
        filter: withUsHours({ assets: [asset], minEdge: 0.06 }),
        label: `us asset=${asset}`,
      }),
    );
  }

  console.log("\n  -- side/remaining @ edge>=0.06 --");
  for (const side of ["up", "down"] as const) {
    printResult(
      evaluate({
        orders,
        filter: withUsHours({ sides: [side], minEdge: 0.06 }),
        label: `us side=${side}`,
      }),
    );
  }
  for (const remaining of [2, 3, 4]) {
    printResult(
      evaluate({
        orders,
        filter: withUsHours({
          minRemainingMin: remaining,
          maxRemainingMin: remaining,
          minEdge: 0.06,
        }),
        label: `us remaining=${remaining}`,
      }),
    );
  }

  console.log("\n  -- price action gates @ edge>=0.06 --");
  for (const minTrendConfirmBp of [0, 2, 4, 6, 8, 10]) {
    printResult(
      evaluate({
        orders,
        filter: withUsHours({ minEdge: 0.06, minTrendConfirmBp }),
        label: `us trend>=${minTrendConfirmBp}`,
      }),
    );
  }
  for (const minSideAlignedMomentumBp of [0, 2, 5, 8]) {
    printResult(
      evaluate({
        orders,
        filter: withUsHours({ minEdge: 0.06, minSideAlignedMomentumBp }),
        label: `us mom30>=${minSideAlignedMomentumBp}`,
      }),
    );
  }
  for (const minSideAlignedMomentum60sBp of [0, 3, 5, 10]) {
    printResult(
      evaluate({
        orders,
        filter: withUsHours({ minEdge: 0.06, minSideAlignedMomentum60sBp }),
        label: `us mom60>=${minSideAlignedMomentum60sBp}`,
      }),
    );
  }

  console.log("\n  -- market microstructure gates @ edge>=0.06 --");
  for (const maxChosenSpread of [0.02, 0.04, 0.06, 0.08, 0.1, 0.12]) {
    printResult(
      evaluate({
        orders,
        filter: withUsHours({ minEdge: 0.06, maxChosenSpread }),
        label: `us spread<=${maxChosenSpread.toFixed(2)}`,
      }),
    );
  }
  for (const minChosenAskDepthRatio of [0.05, 0.1, 0.25, 0.5, 1, 2]) {
    printResult(
      evaluate({
        orders,
        filter: withUsHours({ minEdge: 0.06, minChosenAskDepthRatio }),
        label: `us askDepthRatio>=${minChosenAskDepthRatio}`,
      }),
    );
  }
  for (const maxTakerAskPrice of [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85]) {
    printResult(
      evaluate({
        orders,
        filter: withUsHours({ minEdge: 0.06, maxTakerAskPrice }),
        label: `us ask<=${maxTakerAskPrice.toFixed(2)}`,
      }),
    );
  }
  for (const maxPreEntry30sBelowLimit of [0, 2, 5, 10]) {
    printResult(
      evaluate({
        orders,
        filter: withUsHours({ minEdge: 0.06, maxPreEntry30sBelowLimit }),
        label: `us below30<=${maxPreEntry30sBelowLimit}`,
      }),
    );
  }

  console.log("\n  -- timing gates @ edge>=0.06 --");
  for (const [lo, hi] of [
    [60, 120],
    [120, 180],
    [180, 240],
    [60, 180],
    [120, 240],
  ] as const) {
    printResult(
      evaluate({
        orders,
        filter: withUsHours({
          minEdge: 0.06,
          minSecondsIntoWindow: lo,
          maxSecondsIntoWindow: hi,
        }),
        label: `us sec ${lo}-${hi}`,
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
    if (count < 10) {
      continue;
    }
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
  console.log(
    "\n=== signed distance bp (where price is vs line in our direction) ===",
  );
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
      ...(Number.isFinite(lo) ? { minSignedDistanceBp: lo } : {}),
      ...(Number.isFinite(hi) ? { maxSignedDistanceBp: hi } : {}),
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
  console.log(
    "\n=== pre-entry 30s favorable delta (positive=trend in our favor) ===",
  );
  for (const minDelta of [-Infinity, -2, -1, -0.5, 0, 0.5, 1, 2, 5]) {
    const filter: FilterSpec = Number.isFinite(minDelta)
      ? { minPreEntry30sFavorableDelta: minDelta }
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
  console.log(
    "\n=== max pre-entry 30s below-limit trades (cap adverse pressure) ===",
  );
  for (const max of [Infinity, 50, 30, 20, 10, 5, 2, 0]) {
    const filter: FilterSpec = Number.isFinite(max)
      ? { maxPreEntry30sBelowLimit: max }
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
  console.log(
    "\n=== chosen-side ask size (bigger = more sellers ready to hit our limit) ===",
  );
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
  console.log(
    "\n=== entry 30s deltaBp (recent price momentum, signed by our side) ===",
  );
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
      if (v === null) {
        return false;
      }
      const lov = Number.isFinite(lo) ? lo : -Infinity;
      const hiv = Number.isFinite(hi) ? hi : Infinity;
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
  if (orders.length === 0) {
    return;
  }
  const sortedByPlaced = [...orders].sort(
    (a, b) => a.placedAtMs - b.placedAtMs,
  );
  const minMs = sortedByPlaced[0]!.placedAtMs;
  const maxMs = sortedByPlaced[sortedByPlaced.length - 1]!.placedAtMs;
  const span = maxMs - minMs;
  const bucket = Math.ceil(span / splits);
  console.log(
    `\n=== time-split (${splits} buckets, ${(span / 3600000).toFixed(1)}h span) ===`,
  );
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
if (path === undefined) {
  console.error(
    "usage: bun src/bin/research/sweepReplay.ts <jsonl-path> [sweep|--filter '<json>']",
  );
  process.exit(1);
}

let sweep = "all";
let explicitFilter: string | null = null;
const args = process.argv.slice(3);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--filter") {
    const value = args[index + 1];
    if (value === undefined) {
      throw new Error("--filter requires a JSON value");
    }
    explicitFilter = value;
    index += 1;
    continue;
  }
  if (arg === "--sweep") {
    const value = args[index + 1];
    if (value === undefined) {
      throw new Error("--sweep requires a sweep name");
    }
    sweep = value;
    index += 1;
    continue;
  }
  if (index === 0) {
    sweep = arg ?? "all";
    continue;
  }
  throw new Error(`unknown argument ${arg}`);
}

const resolved = resolve(path);
const orders = loadOrders({ path: resolved });
console.log(`loaded ${orders.length} orders from ${resolved}`);

type UnionFilter = FilterSpec & { readonly any: readonly FilterSpec[] };
type LegacyUnionFilter = FilterSpec & { readonly union: readonly FilterSpec[] };

function applyUnion({
  orders,
  filters,
}: {
  readonly orders: readonly ReplayOrder[];
  readonly filters: readonly FilterSpec[];
}): readonly ReplayOrder[] {
  const seen = new Set<ReplayOrder>();
  for (const f of filters) {
    for (const o of applyFilter({ orders, filter: f })) {
      seen.add(o);
    }
  }
  return [...seen];
}

function filtersForUnion({
  parsed,
}: {
  readonly parsed: UnionFilter | LegacyUnionFilter;
}): readonly FilterSpec[] {
  if ("any" in parsed && Array.isArray(parsed.any)) {
    const { any, ...base } = parsed;
    return any.map((filter) => ({ ...base, ...filter }));
  }
  const legacy = parsed as LegacyUnionFilter;
  const { union, ...base } = legacy;
  return union.map((filter) => ({ ...base, ...filter }));
}

if (explicitFilter !== null && explicitFilter !== undefined) {
  const parsed = JSON.parse(explicitFilter) as
    | FilterSpec
    | UnionFilter
    | LegacyUnionFilter;
  let result: SweepResult;
  let filtered: readonly ReplayOrder[];
  if ("any" in parsed && Array.isArray(parsed.any)) {
    filtered = applyUnion({ orders, filters: filtersForUnion({ parsed }) });
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
      hybrid: computeHybridLens({ orders: filtered, makerAssets: ["doge"] }),
    };
  } else if ("union" in parsed && Array.isArray(parsed.union)) {
    filtered = applyUnion({ orders, filters: filtersForUnion({ parsed }) });
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
      hybrid: computeHybridLens({ orders: filtered, makerAssets: ["doge"] }),
    };
  } else {
    const filter = parsed;
    filtered = applyFilter({ orders, filter });
    result = evaluate({ orders, filter, label: "filter" });
  }
  if (
    ("any" in parsed && Array.isArray(parsed.any)) ||
    ("union" in parsed && Array.isArray(parsed.union))
  ) {
    // attach taker lens for union too
    (result as { taker?: LensMetrics }).taker = computeTakerLens({
      orders: filtered,
    });
  }
  printResult(result);
  // Also show stability across time-buckets (4 chunks)
  splitByTime({ orders: filtered, splits: 4 });
  printTakerFeeSweep({ orders: filtered, label: "filtered" });
  printHybridFeeSweep({ orders: filtered, label: "filtered" });
} else {
  summarizeBaseline(orders);
  if (sweep === "all" || sweep === "min-edge") {
    sweepMinEdge(orders);
  }
  if (sweep === "all" || sweep === "asset") {
    sweepAsset(orders);
  }
  if (sweep === "all" || sweep === "remaining") {
    sweepRemaining(orders);
  }
  if (sweep === "all" || sweep === "side") {
    sweepSide(orders);
  }
  if (sweep === "all" || sweep === "hour") {
    sweepHour(orders);
  }
  if (sweep === "all" || sweep === "us") {
    sweepUsHours(orders);
  }
  if (sweep === "all" || sweep === "queue") {
    sweepQueue(orders);
  }
  if (sweep === "all" || sweep === "regime") {
    sweepRegime(orders);
  }
  if (sweep === "all" || sweep === "limit") {
    sweepLimitPrice(orders);
  }
  if (sweep === "all" || sweep === "signed-distance") {
    sweepSignedDistance(orders);
  }
  if (sweep === "all" || sweep === "favorable") {
    sweepPreEntryFavorable(orders);
  }
  if (sweep === "all" || sweep === "below-limit") {
    sweepMaxBelowLimit(orders);
  }
  if (sweep === "all" || sweep === "book") {
    sweepBookGates(orders);
  }
  if (sweep === "all" || sweep === "momentum") {
    sweepEntryMomentum(orders);
  }
}
