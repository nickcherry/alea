import type { CandleTimeframe } from "@alea/types/candles";

export function pythResolution({
  timeframe,
}: {
  readonly timeframe: CandleTimeframe;
}): string {
  switch (timeframe) {
    case "1m":
      return "1";
    case "5m":
      return "5";
    case "15m":
      return "15";
    case "1h":
      return "60";
  }
}
