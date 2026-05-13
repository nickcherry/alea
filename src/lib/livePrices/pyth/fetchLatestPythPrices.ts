import {
  assetForPythPriceFeedId,
  pythPriceFeedIds,
} from "@alea/lib/livePrices/pyth/pythPriceFeedIds";
import type { Asset } from "@alea/types/assets";
import { z } from "zod";

const hermesEndpoint = "https://hermes.pyth.network";

export type LatestPythPrice = {
  readonly asset: Asset;
  readonly price: number;
  readonly conf: number;
  readonly publishTimeMs: number;
  readonly receivedAtMs: number;
};

export async function fetchLatestPythPrices({
  assets,
  now = () => Date.now(),
  signal,
}: {
  readonly assets: readonly Asset[];
  readonly now?: () => number;
  readonly signal?: AbortSignal;
}): Promise<ReadonlyMap<Asset, LatestPythPrice>> {
  if (assets.length === 0) {
    return new Map();
  }
  const url = buildLatestUrl({ assets });
  const response = await fetch(url, {
    headers: { "User-Agent": "alea/1.0" },
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `pyth hermes latest HTTP ${response.status}: ${await response.text().catch(() => "")}`,
    );
  }
  const raw = await response.json();
  const parsed = latestEnvelopeSchema.parse(raw);
  const receivedAtMs = now();
  const out = new Map<Asset, LatestPythPrice>();
  for (const entry of parsed.parsed ?? []) {
    const asset = assetForPythPriceFeedId({ id: entry.id });
    if (asset === undefined) {
      continue;
    }
    const scale = 10 ** entry.price.expo;
    const priceNum = Number(entry.price.price);
    const confNum = Number(entry.price.conf);
    if (!Number.isFinite(priceNum) || !Number.isFinite(confNum)) {
      continue;
    }
    out.set(asset, {
      asset,
      price: priceNum * scale,
      conf: confNum * scale,
      publishTimeMs: entry.price.publish_time * 1000,
      receivedAtMs,
    });
  }
  return out;
}

function buildLatestUrl({
  assets,
}: {
  readonly assets: readonly Asset[];
}): string {
  const u = new URL("/v2/updates/price/latest", hermesEndpoint);
  for (const asset of assets) {
    const id = pythPriceFeedIds[asset];
    if (id === undefined) {
      throw new Error(`pyth: no price feed id known for asset "${asset}"`);
    }
    // The latest-price endpoint rejects `0x`-prefixed ids even though
    // the streaming endpoint accepts them.
    u.searchParams.append("ids[]", id.replace(/^0x/, ""));
  }
  u.searchParams.set("parsed", "true");
  u.searchParams.set("encoding", "hex");
  return u.toString();
}

const priceSchema = z.object({
  price: z.string(),
  conf: z.string(),
  expo: z.number(),
  publish_time: z.number(),
});

const latestEnvelopeSchema = z
  .object({
    parsed: z
      .array(
        z
          .object({
            id: z.string(),
            price: priceSchema,
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
