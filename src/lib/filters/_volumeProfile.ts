import type { FilterBar } from "@alea/lib/filters/types";

/**
 * A rolling volume profile: total volume bucketed by typical price
 * `(high + low + close) / 3` across a window of bars. Each bar
 * contributes its full volume to the single bin its typical price
 * falls into — coarser than spreading volume across the high–low
 * range, but sufficient for the level-of-interest reads the
 * filters in this directory care about.
 */
export type VolumeProfile = {
  readonly bins: readonly number[];
  readonly min: number;
  readonly max: number;
  readonly binWidth: number;
  readonly total: number;
};

export function buildVolumeProfile({
  bars,
  start,
  endExclusive,
  bins,
}: {
  readonly bars: readonly FilterBar[];
  readonly start: number;
  readonly endExclusive: number;
  readonly bins: number;
}): VolumeProfile | null {
  if (bins <= 0) {
    return null;
  }
  if (start < 0 || endExclusive > bars.length || start >= endExclusive) {
    return null;
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = start; i < endExclusive; i += 1) {
    const bar = bars[i];
    if (bar === undefined) {
      return null;
    }
    const typical = (bar.high + bar.low + bar.close) / 3;
    if (typical < min) {
      min = typical;
    }
    if (typical > max) {
      max = typical;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return null;
  }
  const binWidth = (max - min) / bins;
  const counts: number[] = new Array<number>(bins).fill(0);
  let total = 0;
  for (let i = start; i < endExclusive; i += 1) {
    const bar = bars[i]!;
    const typical = (bar.high + bar.low + bar.close) / 3;
    const rawBin = Math.floor((typical - min) / binWidth);
    const idx = Math.min(bins - 1, Math.max(0, rawBin));
    counts[idx] = (counts[idx] ?? 0) + bar.volume;
    total += bar.volume;
  }
  if (total <= 0) {
    return null;
  }
  return { bins: counts, min, max, binWidth, total };
}

/**
 * Resolves the value area (price range containing `valueAreaPct` of
 * total volume, expanded around the POC by always taking whichever
 * adjacent bin carries more volume). Returns the lower and upper
 * price bounds of the value area along with the POC bin index.
 */
export function valueArea({
  profile,
  valueAreaPct,
}: {
  readonly profile: VolumeProfile;
  readonly valueAreaPct: number;
}): {
  readonly valPrice: number;
  readonly vahPrice: number;
  readonly pocBin: number;
} | null {
  if (valueAreaPct <= 0 || valueAreaPct > 1) {
    return null;
  }
  if (profile.bins.length === 0) {
    return null;
  }
  let pocBin = 0;
  let pocVol = profile.bins[0]!;
  for (let i = 1; i < profile.bins.length; i += 1) {
    const v = profile.bins[i]!;
    if (v > pocVol) {
      pocVol = v;
      pocBin = i;
    }
  }
  const target = profile.total * valueAreaPct;
  let left = pocBin;
  let right = pocBin;
  let acc = pocVol;
  while (acc < target && (left > 0 || right < profile.bins.length - 1)) {
    const leftAdd = left > 0 ? (profile.bins[left - 1] ?? 0) : -1;
    const rightAdd =
      right < profile.bins.length - 1 ? (profile.bins[right + 1] ?? 0) : -1;
    if (rightAdd >= leftAdd && right < profile.bins.length - 1) {
      right += 1;
      acc += rightAdd;
    } else if (left > 0) {
      left -= 1;
      acc += leftAdd;
    } else {
      break;
    }
  }
  const valPrice = profile.min + left * profile.binWidth;
  const vahPrice = profile.min + (right + 1) * profile.binWidth;
  return { valPrice, vahPrice, pocBin };
}

/**
 * Convenience: which bin a price lands in. Clamped to
 * `[0, bins.length - 1]`. Returns null if the profile has no
 * range to bucket against.
 */
export function profileBinFor({
  profile,
  price,
}: {
  readonly profile: VolumeProfile;
  readonly price: number;
}): number | null {
  if (profile.binWidth <= 0) {
    return null;
  }
  const rawBin = Math.floor((price - profile.min) / profile.binWidth);
  return Math.min(profile.bins.length - 1, Math.max(0, rawBin));
}
