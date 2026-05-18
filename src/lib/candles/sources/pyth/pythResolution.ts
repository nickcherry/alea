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
    case "4h":
      return "240";
    case "1d":
      // Pyth's TradingView shim accepts both "D" and "1D" for daily bars;
      // "D" is the canonical TradingView resolution literal.
      return "D";
  }
}
