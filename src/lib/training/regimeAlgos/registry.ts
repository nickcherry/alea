import { volXRsiDivergenceAlgos } from "@alea/lib/training/regimeAlgos/rsiDivergence/volXAlgo";
import { trendXVol6Algo } from "@alea/lib/training/regimeAlgos/trendXVol6";
import type { RegimeAlgo } from "@alea/lib/training/regimeAlgos/types";
import { volOnly3Algo } from "@alea/lib/training/regimeAlgos/volOnly3";
import { volQuartiles4Algo } from "@alea/lib/training/regimeAlgos/volQuartiles4";

/**
 * The dashboard's active regime-algo set. Each algo here gets a
 * comparison section in the training-distributions dashboard so we
 * can eyeball which partitioning best separates outcomes before
 * committing one as the live probability table's regime axis.
 *
 * Adding a new algo: one file under `regimeAlgos/` + one line here.
 *
 * Keep the active set small. Every algo here gets computed for every
 * snapshot at `training:distributions` time and rendered as its own
 * section. Signal-to-noise on the dashboard depends on the list
 * staying focused.
 *
 * Order here is the dashboard render order. Put the live algos first
 * so the LIVE-badged sections appear at the top of the page.
 *
 * 2026-05-10 prune: down from 16 to 5 entries. Top 5 by mean
 * `calibrationScore` across btc/eth/sol/xrp from a 730d gen-table
 * run; everything else (`bar_carry_2`, the 6 standalone
 * `rsi_div_*`, and the 4 longer-lookback `vol3_x_rsidiv_*` w5/w7
 * variants) was contributing dashboard noise without competitive
 * lift. Their underlying detection code is preserved in this folder
 * so adding any of them back is a one-line registry edit.
 */
export const regimeAlgos: readonly RegimeAlgo[] = [
  volOnly3Algo,
  volQuartiles4Algo,
  trendXVol6Algo,
  ...volXRsiDivergenceAlgos,
];
