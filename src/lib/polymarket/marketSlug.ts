import type { Asset } from "@alea/types/assets";
import type { ResolutionTimeframe } from "@alea/types/resolutions";

const assetHourlySlugNames = {
  btc: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  xrp: "xrp",
  doge: "dogecoin",
} as const satisfies Record<Asset, string>;

const easternMonthFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
});
const easternDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  day: "numeric",
});
const easternYearFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
});
const easternHourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  hour12: true,
});

/** Builds the venue's ET-formatted hourly crypto up/down event slug. */
export function polymarketUpDownEventSlug({
  asset,
  windowStartUnixSeconds,
}: {
  readonly asset: Asset;
  readonly timeframe: ResolutionTimeframe;
  readonly windowStartUnixSeconds: number;
}): string {
  const date = new Date(windowStartUnixSeconds * 1000);
  const assetName = assetHourlySlugNames[asset];
  const month = easternMonthFormatter.format(date).toLowerCase();
  const day = easternDayFormatter.format(date);
  const year = easternYearFormatter.format(date);
  const hour = easternHourFormatter
    .format(date)
    .toLowerCase()
    .replace(/\s/g, "");
  return `${assetName}-up-or-down-${month}-${day}-${year}-${hour}-et`;
}
