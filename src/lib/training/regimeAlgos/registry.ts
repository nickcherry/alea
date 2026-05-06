import { trendXVol6Algo } from "@alea/lib/training/regimeAlgos/trendXVol6";
import type { RegimeAlgo } from "@alea/lib/training/regimeAlgos/types";
import { volOnly3Algo } from "@alea/lib/training/regimeAlgos/volOnly3";
import { volQuartiles4Algo } from "@alea/lib/training/regimeAlgos/volQuartiles4";

/**
 * The dashboard's active regime-algo set. Each algo here gets a
 * comparison section in the training-distributions dashboard so we can
 * eyeball which partitioning best separates outcomes before committing
 * one as the live probability table's regime axis.
 *
 * Adding a new algo: one file under `regimeAlgos/` + one line here.
 *
 * Keep the active set small. Every algo here gets computed for every
 * snapshot at `training:distributions` time and rendered as its own
 * section. Signal-to-noise on the dashboard depends on the list staying
 * focused.
 *
 * Order here is the dashboard render order. Put the live algo first so
 * the LIVE-badged section appears at the top of the page.
 */
export const regimeAlgos: readonly RegimeAlgo[] = [
  volOnly3Algo,
  volQuartiles4Algo,
  trendXVol6Algo,
];
