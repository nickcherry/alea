import { z } from "zod";

/**
 * Direction of the next-bar prediction / the side of a trade. `up`
 * means we expect / are betting on close > open; `down` the other.
 */
export const leadingSideSchema = z.enum(["up", "down"]);
export type LeadingSide = z.infer<typeof leadingSideSchema>;
