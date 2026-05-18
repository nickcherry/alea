import type { ResolutionTimeframe } from "@alea/types/resolutions";

/**
 * Timeframes shown by Polymarket/candle-derived dashboards. This is
 * intentionally explicit so operator dashboards follow the current 1h-only
 * trading surface.
 */
export const DASHBOARD_RESOLUTION_TIMEFRAMES = [
  "1h",
] as const satisfies readonly ResolutionTimeframe[];

export type DashboardResolutionTimeframe =
  (typeof DASHBOARD_RESOLUTION_TIMEFRAMES)[number];
