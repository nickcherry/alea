import type { RegimeAlgo } from "@alea/lib/training/regimeAlgos/types";
import { volOnly3Algo } from "@alea/lib/training/regimeAlgos/volOnly3";
import { volX } from "@alea/lib/training/regimeAlgos/volX";

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
 * 2026-05-10 reset: dropped `vol_quartiles_4`, `trend_x_vol_6`, the
 * entire RSI-divergence experiment, and a handful of vol×X axes that
 * round-1 found below baseline (`bar_carry`, `rsi_zone`, `ema_trend`,
 * `atr_accel_strict`). The four entries here passed two filters: the
 * mean cross-asset `calibrationScore` is at-or-above `vol_only_3`,
 * and the per-cell win-rate deltas within each vol tier are
 * asymmetric (i.e. clearly directional, not noise). The picker auto-
 * promotes whichever (asset, algo, regime) tuple leads the baseline
 * by ≥ `LEADING_REGIME_MIN_LEAD_PP` at gen-table time.
 */
export const regimeAlgos: readonly RegimeAlgo[] = [
  volOnly3Algo,
  volX.atrAccel6,
  volX.rsiAlign6,
  volX.atrAccelXRsiAlign12,
];
