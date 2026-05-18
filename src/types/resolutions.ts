import { z } from "zod";

/** Timeframes Alea trades on Polymarket up/down crypto markets. */
export const resolutionTimeframeValues = ["1h"] as const;

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
