import type { ResolutionTimeframe } from "@alea/types/resolutions";

const millisecondsPerSecond = 1000;

/**
 * Bar duration in milliseconds for a Polymarket up/down market
 * timeframe. Same shape as `timeframeMs` from the candles layer, but
 * kept resolution-specific so 1m is never accidentally enumerated as
 * a Polymarket window (Polymarket doesn't publish 1m up/down).
 */
export function resolutionTimeframeStepMs({
  timeframe,
}: {
  readonly timeframe: ResolutionTimeframe;
}): number {
  switch (timeframe) {
    case "1h":
      return 60 * 60 * millisecondsPerSecond;
  }
}

/**
 * Enumerates window start timestamps for `[start, end)` snapped to the
 * timeframe's bar boundary, **newest first**.
 *
 * Both endpoints are snapped: Polymarket slug discovery only works on
 * the venue's exact 1h grid. An off-grid start (e.g. `new Date()`'s
 * millisecond resolution) would otherwise produce slugs that never
 * resolve, and the sync would record every window as "missing" instead
 * of "resolved".
 *
 * Walking newest-first means the dashboard fills with the most recent
 * (and most relevant) data first, and the trailing missing-slug
 * requests for windows beyond Polymarket's retention only affect the
 * long tail.
 */
export function enumerateResolutionWindowStarts({
  start,
  end,
  stepMs,
}: {
  readonly start: Date;
  readonly end: Date;
  readonly stepMs: number;
}): readonly number[] {
  const startMs = Math.ceil(start.getTime() / stepMs) * stepMs;
  const endMs = Math.floor(end.getTime() / stepMs) * stepMs;
  const out: number[] = [];
  for (let ts = endMs - stepMs; ts >= startMs; ts -= stepMs) {
    out.push(ts);
  }
  return out;
}
