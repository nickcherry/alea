import { formatDryRunEvent } from "@alea/lib/trading/dryRun/formatDryRunEvent";
import type { ReplayRunEvent } from "@alea/lib/trading/replay/types";

/**
 * Replay events match dry-run events shape-for-shape; reuse the
 * dry-run formatter rather than duplicating the colour logic. Kept as
 * a separate function so we can swap in replay-specific rendering
 * later without rippling through the orchestrator.
 */
export function formatReplayEvent({
  event,
}: {
  readonly event: ReplayRunEvent;
}): string {
  return formatDryRunEvent({ event });
}
