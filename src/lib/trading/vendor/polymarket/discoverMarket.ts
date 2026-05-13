import { polymarket } from "@alea/constants/polymarket";
import type { TradableMarket } from "@alea/lib/trading/vendor/types";
import type { Asset } from "@alea/types/assets";
import type { ResolutionTimeframe } from "@alea/types/resolutions";
import { z } from "zod";

/**
 * Polymarket "up/down" market lookup via the public gamma-api.
 * Slug is fixed by the venue: `<asset>-updown-<5m|15m>-<unixSeconds>`,
 * where `unixSeconds` is the window *start* (UTC, aligned to the
 * timeframe grid).
 *
 * Returns `null` when the slug doesn't resolve to anything that
 * matches the expected up/down shape (degenerate outcomes, missing
 * token ids). Callers treat `null` as "skip this window".
 *
 * The earlier draft also looked up venue tick/min-size constraints
 * off the CLOB so the live trader could submit valid orders. That
 * trader is gone; market discovery now only resolves the three opaque
 * ids the capture/reliability pipelines need to subscribe to the
 * stream.
 */
export async function discoverPolymarketMarket({
  asset,
  timeframe = "5m",
  windowStartUnixSeconds,
  signal,
}: {
  readonly asset: Asset;
  readonly timeframe?: ResolutionTimeframe;
  readonly windowStartUnixSeconds: number;
  readonly signal?: AbortSignal;
}): Promise<TradableMarket | null> {
  const slug = `${asset}-updown-${timeframe}-${windowStartUnixSeconds}`;
  const url = `${polymarket.gammaApiUrl}/events?slug=${slug}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "alea/1.0" },
    signal,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `gamma-api /events?slug=${slug} failed: ${response.status} ${previewBody(body)}`,
    );
  }
  const parsed = eventListSchema.safeParse(await response.json());
  if (!parsed.success) {
    return null;
  }
  const event = parsed.data[0];
  const market = event?.markets[0];
  if (event === undefined || market === undefined) {
    return null;
  }
  const outcomes = parseStringArray(market.outcomes);
  const tokenIds = parseStringArray(market.clobTokenIds);
  if (
    outcomes === null ||
    tokenIds === null ||
    outcomes.length !== 2 ||
    tokenIds.length !== 2 ||
    outcomes[0] !== "Up" ||
    outcomes[1] !== "Down"
  ) {
    return null;
  }
  const upRef = tokenIds[0];
  const downRef = tokenIds[1];
  if (upRef === undefined || downRef === undefined) {
    return null;
  }
  return {
    asset,
    vendorRef: market.conditionId,
    upRef,
    downRef,
    ...optionalTickSize({ value: market.orderPriceMinTickSize }),
  };
}

function optionalTickSize({
  value,
}: {
  readonly value: string | number | undefined;
}): { readonly tickSize: number } | Record<string, never> {
  const parsed =
    typeof value === "string" || typeof value === "number"
      ? Number(value)
      : null;
  if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) {
    return {};
  }
  return { tickSize: parsed };
}

function parseStringArray(value: string | undefined): string[] | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const out: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string") {
        return null;
      }
      out.push(entry);
    }
    return out;
  } catch {
    return null;
  }
}

const marketSchema = z
  .object({
    conditionId: z.string(),
    outcomes: z.string().optional(),
    clobTokenIds: z.string().optional(),
    orderPriceMinTickSize: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const eventSchema = z
  .object({ slug: z.string(), markets: z.array(marketSchema) })
  .passthrough();

const eventListSchema = z.array(eventSchema);

function previewBody(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 300) {
    return collapsed;
  }
  return `${collapsed.slice(0, 300)}...`;
}
