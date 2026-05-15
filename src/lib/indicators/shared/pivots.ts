import { requirePositiveInteger } from "@alea/lib/indicators/shared/series";

export type PivotPoint = {
  readonly index: number;
  readonly value: number;
};

export function findPivotLows({
  values,
  leftBars,
  rightBars,
}: {
  readonly values: readonly (number | null)[];
  readonly leftBars: number;
  readonly rightBars: number;
}): readonly PivotPoint[] {
  return findPivots({
    values,
    leftBars,
    rightBars,
    isPivot: (candidate, neighbor) => candidate < neighbor,
  });
}

export function findPivotHighs({
  values,
  leftBars,
  rightBars,
}: {
  readonly values: readonly (number | null)[];
  readonly leftBars: number;
  readonly rightBars: number;
}): readonly PivotPoint[] {
  return findPivots({
    values,
    leftBars,
    rightBars,
    isPivot: (candidate, neighbor) => candidate > neighbor,
  });
}

function findPivots({
  values,
  leftBars,
  rightBars,
  isPivot,
}: {
  readonly values: readonly (number | null)[];
  readonly leftBars: number;
  readonly rightBars: number;
  readonly isPivot: (candidate: number, neighbor: number) => boolean;
}): readonly PivotPoint[] {
  requirePositiveInteger({ name: "leftBars", value: leftBars });
  requirePositiveInteger({ name: "rightBars", value: rightBars });

  const pivots: PivotPoint[] = [];
  for (let i = leftBars; i < values.length - rightBars; i += 1) {
    const candidate = values[i];
    if (candidate === null || candidate === undefined) {
      continue;
    }
    let valid = true;
    for (let j = i - leftBars; j <= i + rightBars; j += 1) {
      if (j === i) {
        continue;
      }
      const neighbor = values[j];
      if (
        neighbor === null ||
        neighbor === undefined ||
        !isPivot(candidate, neighbor)
      ) {
        valid = false;
        break;
      }
    }
    if (valid) {
      pivots.push({ index: i, value: candidate });
    }
  }
  return pivots;
}

