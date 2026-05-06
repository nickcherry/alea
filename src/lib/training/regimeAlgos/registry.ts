import { prevBarCarry2Algo } from "@alea/lib/training/regimeAlgos/prevBarCarry2";
import { rsi3Algo } from "@alea/lib/training/regimeAlgos/rsi3";
import { trendOnly3Algo } from "@alea/lib/training/regimeAlgos/trendOnly3";
import { trendStrength3Algo } from "@alea/lib/training/regimeAlgos/trendStrength3";
import { trendXVol6Algo } from "@alea/lib/training/regimeAlgos/trendXVol6";
import type { RegimeAlgo } from "@alea/lib/training/regimeAlgos/types";
import { volOnly2Algo } from "@alea/lib/training/regimeAlgos/volOnly2";
import { volOnly2Atr3Algo } from "@alea/lib/training/regimeAlgos/volOnly2Atr3";
import { volOnly2TightAlgo } from "@alea/lib/training/regimeAlgos/volOnly2Tight";
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
  volOnly2Algo,
  volOnly2TightAlgo,
  volOnly2Atr3Algo,
  volOnly3Algo,
  volQuartiles4Algo,
  trendXVol6Algo,
  trendStrength3Algo,
  trendOnly3Algo,
  prevBarCarry2Algo,
  rsi3Algo,
];
