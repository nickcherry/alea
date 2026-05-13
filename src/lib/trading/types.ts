import { z } from "zod";

/**
 * Direction of the target-candle prediction / the side of a trade. `up`
 * means we expect the target market to settle above its reference
 * open; `down` means below. Training can drop tiny Pyth moves before
 * mapping a target candle to either side.
 */
export const leadingSideSchema = z.enum(["up", "down"]);
export type LeadingSide = z.infer<typeof leadingSideSchema>;
