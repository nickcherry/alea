import type { LeadingSide } from "@alea/lib/trading/types";
import type { PolymarketOrderConstraints } from "@alea/lib/trading/vendor/polymarket/marketConstraints";
import {
  FakNoMatchRejectionError,
  type PlacedTakerMarketBuy,
  type TradableMarket,
} from "@alea/lib/trading/vendor/types";
import { type ClobClient, OrderType, Side } from "@polymarket/clob-client-v2";
import { z } from "zod";

/**
 * Substring (case-insensitive) used to detect the venue's
 * "FAK had no match" rejection. Polymarket returns the literal
 *   "no orders found to match with FAK order"
 * as `errorMsg`. Match on a stable phrase ("no orders found to
 * match") so a wording tweak doesn't silently break the
 * classification.
 */
const FAK_NO_MATCH_PHRASE = "no orders found to match";

/**
 * FAK taker BUY of a YES outcome token on Polymarket. `limitPrice` is the
 * worst price accepted from the just-in-time book walk; any unfilled
 * remainder is killed by the venue rather than left resting.
 */
export async function placePolymarketTakerMarketBuy({
  client,
  market,
  side,
  limitPrice,
  sharesIfFilled,
  stakeUsd,
  constraints,
}: {
  readonly client: ClobClient;
  readonly market: TradableMarket;
  readonly side: LeadingSide;
  readonly limitPrice: number;
  readonly sharesIfFilled: number;
  readonly stakeUsd: number;
  readonly constraints: PolymarketOrderConstraints;
}): Promise<PlacedTakerMarketBuy> {
  if (!Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice >= 1) {
    throw new Error(
      `placePolymarketTakerMarketBuy: limitPrice must be in (0, 1), got ${limitPrice}`,
    );
  }
  if (sharesIfFilled < constraints.minOrderSize) {
    throw new Error(
      `placePolymarketTakerMarketBuy: expected shares ${sharesIfFilled} below venue minimum ${constraints.minOrderSize}`,
    );
  }
  const tokenId = side === "up" ? market.upRef : market.downRef;
  const tickedLimit = ceilToTick({
    price: limitPrice,
    tickSize: constraints.priceTickSize,
  });
  const response = await client.createAndPostMarketOrder(
    {
      tokenID: tokenId,
      amount: stakeUsd,
      side: Side.BUY,
      price: tickedLimit,
      orderType: OrderType.FAK,
    },
    { negRisk: constraints.negRisk, tickSize: constraints.tickSize },
    OrderType.FAK,
  );

  const parsed = postOrderResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(
      `placePolymarketTakerMarketBuy: unexpected postOrder response shape: ${JSON.stringify(response)}`,
    );
  }
  const responseError =
    nonEmptyString(parsed.data.errorMsg) ?? nonEmptyString(parsed.data.error);
  if (parsed.data.success === false || responseError !== undefined) {
    const message = `placePolymarketTakerMarketBuy: postOrder rejected: ${responseError ?? "unknown error"}`;
    if (
      responseError !== undefined &&
      responseError.toLowerCase().includes(FAK_NO_MATCH_PHRASE)
    ) {
      throw new FakNoMatchRejectionError(message);
    }
    throw new Error(message);
  }

  return {
    orderId: null,
    side,
    outcomeRef: tokenId,
    limitPrice: tickedLimit,
    sharesIfFilled,
    feeRateBps: constraints.takerBaseFeeBps ?? 0,
    orderType: "FAK",
    expiresAtMs: null,
    placedAtMs: Date.now(),
  };
}

function nonEmptyString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function ceilToTick({
  price,
  tickSize,
}: {
  readonly price: number;
  readonly tickSize: number;
}): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) {
    throw new Error(`invalid tick size ${tickSize}`);
  }
  const decimals = decimalPlaces({ value: tickSize });
  return Number(
    (Math.ceil((price - 1e-12) / tickSize) * tickSize).toFixed(decimals),
  );
}

function decimalPlaces({ value }: { readonly value: number }): number {
  const text = value.toString();
  const decimal = text.indexOf(".");
  return decimal === -1 ? 0 : text.length - decimal - 1;
}

const postOrderResponseSchema = z
  .object({
    success: z.boolean().optional(),
    errorMsg: z.string().optional(),
    error: z.string().optional(),
    status: z.union([z.number(), z.string()]).optional(),
    orderID: z.string().optional(),
  })
  .passthrough();
