import {
  computeTradeEconomics,
  type TradeEconomics,
} from "@alea/lib/trading/decision/computeTradeEconomics";
import type { LeadingSide } from "@alea/lib/trading/types";
import type { Asset } from "@alea/types/assets";

/**
 * One order from a replay JSONL session, projected down to the
 * fields the calibration sweep needs. The replay JSONL carries a
 * lot more (telemetry, edge, regime, etc.); we only need the bits
 * that determine "would we have taken this trade?" and "did it
 * win?".
 */
export type CalibrationOrder = {
  readonly asset: Asset;
  readonly side: LeadingSide;
  /** Probability the chosen side wins, per the model at decision time. */
  readonly modelProbability: number;
  /**
   * Taker book-walk economics — depth-weighted avg fill price and
   * the shares clearable at the wallet's stake.
   */
  readonly taker: {
    readonly fillPrice: number;
    readonly sharesIfFilled: number;
    readonly costUsd: number;
  };
  /**
   * Venue-truth winner of the market. `null` when neither chainlink
   * nor polymarket resolved (rare; those orders are dropped from
   * the sweep).
   */
  readonly winningSide: LeadingSide | null;
};

export type CalibrationCellStats = {
  readonly taken: number;
  readonly wins: number;
  readonly winRate: number;
  readonly pnlUsd: number;
  readonly feesUsd: number;
  readonly pnlPerTrade: number;
};

export type CalibrationCell = {
  readonly minEvUsd: number;
  readonly minRewardRiskRatio: number;
  readonly stats: CalibrationCellStats;
};

export type CalibrationResult = {
  readonly orderCount: number;
  readonly evaluableOrderCount: number;
  /** Stats with no EV / RR gate applied (every evaluable order takes). */
  readonly baseline: CalibrationCellStats;
  readonly cells: readonly CalibrationCell[];
};

/**
 * Polymarket's actual taker fee rate, derived empirically from the
 * data-api `/activity` cashflow ledger (the venue's `/trades` field
 * reports `"0"` even when fees were charged). At 700 bps the fee
 * formula matches `usdcSize − size × price` to ~0.001 USD across
 * dozens of sample TRADE events.
 */
export const POLYMARKET_TAKER_FEE_RATE = 0.07;

/**
 * Default sweep grids — wide enough to surface the joint maximum,
 * coarse enough for the heatmap output to fit on a terminal. Tune
 * via the CLI flags if a finer sweep is needed.
 */
export const DEFAULT_MIN_EV_GRID: readonly number[] = [
  0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4,
];
export const DEFAULT_MIN_RR_GRID: readonly number[] = [
  0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5,
];

/**
 * Estimate the venue fee in USD for a single taker fill using
 * Polymarket's `shares × feeRate × price × (1 − price)` formula.
 * This is the same shape `computePolymarketFeeUsd` ships, inlined
 * here to keep the calibration module dependency-free of the
 * vendor-specific fee helper.
 */
export function estimateTakerFeeUsd({
  shares,
  fillPrice,
  feeRate,
}: {
  readonly shares: number;
  readonly fillPrice: number;
  readonly feeRate: number;
}): number {
  if (
    !Number.isFinite(shares) ||
    !Number.isFinite(fillPrice) ||
    !Number.isFinite(feeRate)
  ) {
    return 0;
  }
  if (shares <= 0 || fillPrice <= 0 || fillPrice >= 1 || feeRate <= 0) {
    return 0;
  }
  return shares * feeRate * fillPrice * (1 - fillPrice);
}

/**
 * Per-order economics + outcome, ready to feed into the gate sweep.
 * Return null for orders we can't evaluate as taker (no usable
 * counterfactual or no venue-truth outcome).
 */
function projectOrder({
  order,
  takerFeeRate,
}: {
  readonly order: CalibrationOrder;
  readonly takerFeeRate: number;
}): {
  readonly economics: TradeEconomics;
  readonly won: boolean;
} | null {
  if (order.winningSide === null) {
    return null;
  }
  const fillPrice = order.taker.fillPrice;
  const shares = order.taker.sharesIfFilled;
  const stakeUsd = order.taker.costUsd;
  const feeUsd = estimateTakerFeeUsd({
    shares,
    fillPrice,
    feeRate: takerFeeRate,
  });
  const economics = computeTradeEconomics({
    stakeUsd,
    fillPrice,
    ourProbability: order.modelProbability,
    feeUsd,
  });
  if (economics === null) {
    return null;
  }
  return {
    economics,
    won: order.winningSide === order.side,
  };
}

/**
 * Apply a single (MIN_EV, MIN_RR) cell to the orders and return the
 * aggregate pass-through stats. Pass `Number.NEGATIVE_INFINITY` for
 * either threshold to disable that gate (the baseline row).
 */
export function evaluateGateCell({
  orders,
  minEvUsd,
  minRewardRiskRatio,
  takerFeeRate = POLYMARKET_TAKER_FEE_RATE,
}: {
  readonly orders: readonly CalibrationOrder[];
  readonly minEvUsd: number;
  readonly minRewardRiskRatio: number;
  readonly takerFeeRate?: number;
}): CalibrationCellStats {
  let taken = 0;
  let wins = 0;
  let pnlUsd = 0;
  let feesUsd = 0;
  for (const order of orders) {
    const projected = projectOrder({ order, takerFeeRate });
    if (projected === null) {
      continue;
    }
    const { economics, won } = projected;
    if (
      economics.evUsd < minEvUsd ||
      economics.rewardRiskRatio < minRewardRiskRatio
    ) {
      continue;
    }
    taken += 1;
    if (won) {
      wins += 1;
      pnlUsd += economics.grossWinUsd - economics.stakeUsd - economics.feeUsd;
    } else {
      pnlUsd += -economics.stakeUsd - economics.feeUsd;
    }
    feesUsd += economics.feeUsd;
  }
  return {
    taken,
    wins,
    winRate: taken > 0 ? wins / taken : 0,
    pnlUsd,
    feesUsd,
    pnlPerTrade: taken > 0 ? pnlUsd / taken : 0,
  };
}

/**
 * Run the full sweep across an EV × RR grid. Cell ordering is
 * row-major (outer EV, inner RR) to make the heatmap renderer
 * simple.
 */
export function calibrateEvRrGate({
  orders,
  evGrid = DEFAULT_MIN_EV_GRID,
  rrGrid = DEFAULT_MIN_RR_GRID,
  takerFeeRate = POLYMARKET_TAKER_FEE_RATE,
}: {
  readonly orders: readonly CalibrationOrder[];
  readonly evGrid?: readonly number[];
  readonly rrGrid?: readonly number[];
  readonly takerFeeRate?: number;
}): CalibrationResult {
  let evaluable = 0;
  for (const order of orders) {
    const projected = projectOrder({ order, takerFeeRate });
    if (projected !== null) {
      evaluable += 1;
    }
  }
  const baseline = evaluateGateCell({
    orders,
    minEvUsd: Number.NEGATIVE_INFINITY,
    minRewardRiskRatio: Number.NEGATIVE_INFINITY,
    takerFeeRate,
  });
  const cells: CalibrationCell[] = [];
  for (const minEvUsd of evGrid) {
    for (const minRewardRiskRatio of rrGrid) {
      cells.push({
        minEvUsd,
        minRewardRiskRatio,
        stats: evaluateGateCell({
          orders,
          minEvUsd,
          minRewardRiskRatio,
          takerFeeRate,
        }),
      });
    }
  }
  return {
    orderCount: orders.length,
    evaluableOrderCount: evaluable,
    baseline,
    cells,
  };
}
