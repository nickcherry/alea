import { z } from "zod";

/**
 * Timeframes Polymarket publishes up/down crypto markets for. 5m markets
 * exist on every 5-minute boundary; 15m markets exist only on :00 / :15 /
 * :30 / :45 boundaries.
 */
export const resolutionTimeframeValues = ["5m", "15m"] as const;

export const resolutionTimeframeSchema = z.enum(resolutionTimeframeValues);

export type ResolutionTimeframe = z.infer<typeof resolutionTimeframeSchema>;

/**
 * Settlement direction recorded by Polymarket. `void` covers markets
 * that closed without a winning side (refunded / disputed). We still
 * store these so the sync loop knows not to re-fetch them.
 */
export const resolutionOutcomeValues = ["up", "down", "void"] as const;

export const resolutionOutcomeSchema = z.enum(resolutionOutcomeValues);

export type ResolutionOutcome = z.infer<typeof resolutionOutcomeSchema>;
