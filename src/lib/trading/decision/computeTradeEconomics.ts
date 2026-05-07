import { WINNING_YES_PAYOUT_USD } from "@alea/constants/trading";

/**
 * Pure dollar-denominated breakdown of a candidate trade. Inputs are
 * the realized fill price (post book-walk for taker, the resting bid
 * for maker), the venue fee in USD at that fill, the stake, and our
 * model probability for the chosen side. Outputs are the four
 * derived quantities the EV / reward-risk gates check:
 *
 *   shares          = stake / fillPrice
 *   grossWinUsd     = shares * WINNING_YES_PAYOUT_USD
 *   netWinUsd       = grossWinUsd − feeUsd − stake
 *   evUsd           = P * netWinUsd − (1 − P) * stake
 *   rewardRiskRatio = netWinUsd / stake
 *
 * Why both EV and RR:
 * - EV alone can be satisfied by very high P × tiny netWin (e.g. P=0.95,
 *   netWin=$2: EV ≈ $0.90, looks fine on average but every individual
 *   loser is -$20 vs every individual winner +$2, so a single bad streak
 *   wipes out a lot of trades' worth of EV).
 * - RR alone ignores model confidence (P=0.30, netWin=$50, stake=$20:
 *   RR=2.5 looks great but EV is negative).
 * Both together pin both axes of "is this worth doing?".
 *
 * Returns `null` when the inputs make no economic sense — fillPrice
 * outside `(0, 1)` (no real market), or stake ≤ 0. Callers treat
 * `null` as "side ineligible for this gate".
 */

export type TradeEconomics = {
  readonly stakeUsd: number;
  readonly fillPrice: number;
  readonly ourProbability: number;
  readonly shares: number;
  readonly feeUsd: number;
  readonly grossWinUsd: number;
  readonly netWinUsd: number;
  readonly evUsd: number;
  readonly rewardRiskRatio: number;
};

export function computeTradeEconomics({
  stakeUsd,
  fillPrice,
  ourProbability,
  feeUsd,
}: {
  readonly stakeUsd: number;
  readonly fillPrice: number;
  readonly ourProbability: number;
  /** Total venue fee for this trade, in USD. Maker fills typically pass 0. */
  readonly feeUsd: number;
}): TradeEconomics | null {
  if (
    !Number.isFinite(stakeUsd) ||
    !Number.isFinite(fillPrice) ||
    !Number.isFinite(ourProbability) ||
    !Number.isFinite(feeUsd)
  ) {
    return null;
  }
  if (stakeUsd <= 0 || fillPrice <= 0 || fillPrice >= 1) {
    return null;
  }
  if (ourProbability < 0 || ourProbability > 1) {
    return null;
  }
  const shares = stakeUsd / fillPrice;
  const grossWinUsd = shares * WINNING_YES_PAYOUT_USD;
  const netWinUsd = grossWinUsd - feeUsd - stakeUsd;
  const evUsd = ourProbability * netWinUsd - (1 - ourProbability) * stakeUsd;
  const rewardRiskRatio = netWinUsd / stakeUsd;
  return {
    stakeUsd,
    fillPrice,
    ourProbability,
    shares,
    feeUsd: Math.max(0, feeUsd),
    grossWinUsd,
    netWinUsd,
    evUsd,
    rewardRiskRatio,
  };
}
