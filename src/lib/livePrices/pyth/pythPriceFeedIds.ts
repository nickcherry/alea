import type { Asset } from "@alea/types/assets";

/**
 * Pyth Network price-feed IDs for every asset in the universe. Used by
 * the Hermes SSE stream (data:capture, reliability:capture). The IDs
 * are stable across networks (Solana, EVM chains, Hermes) and uniquely
 * identify a `Crypto.<asset>/USD` aggregate. Looked up via
 * `https://hermes.pyth.network/v2/price_feeds?asset_type=crypto`.
 *
 * Hermes accepts the IDs with or without a `0x` prefix; we keep the
 * prefix here so they're greppable next to the on-chain accounts on
 * Solana / EVM block explorers.
 */
export const pythPriceFeedIds: Record<Asset, string> = {
  btc: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  eth: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  sol: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  xrp: "0xec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8",
  doge: "0xdcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c",
};

/**
 * Reverse lookup: given a Pyth feed id (hex, with or without `0x`),
 * return the asset whose ticks should land on the consumer. Comparison
 * is case-insensitive and ignores any `0x` prefix.
 */
export function assetForPythPriceFeedId({
  id,
}: {
  readonly id: string;
}): Asset | undefined {
  const normalized = id.toLowerCase().replace(/^0x/, "");
  for (const [asset, feedId] of Object.entries(pythPriceFeedIds)) {
    if (feedId.toLowerCase().replace(/^0x/, "") === normalized) {
      return asset as Asset;
    }
  }
  return undefined;
}
