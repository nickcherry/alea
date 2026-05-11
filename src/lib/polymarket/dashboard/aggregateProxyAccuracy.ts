import type {
  ProxyAccuracyAggregate,
  ProxyMoveBucket,
} from "@alea/lib/polymarket/dashboard/types";

/**
 * Histogram bucket upper-bounds in absolute percent move. Designed
 * around the question "is this disagreement boundary noise or a real
 * proxy drift?": the bottom three buckets (0–2 bp) are the
 * jitter-friendly zone where we expect occasional flips even with a
 * good proxy, and the higher buckets surface clear-direction
 * disagreements that would cost us real wins.
 *
 * Values are in percent — `0.01` means 1 basis point. Each row counts
 * windows where `previousUpper ≤ |move%| < thisUpper`; the trailing
 * `null` bucket is the unbounded tail above the last finite boundary.
 */
export const MOVE_BUCKETS_PCT: readonly (number | null)[] = [
  0.01, // < 1 bp
  0.02, // 1–2 bp
  0.05, // 2–5 bp
  0.1, //  5–10 bp
  0.2, //  10–20 bp
  0.5, //  20–50 bp
  null, // ≥ 50 bp
];

export type ProxyAccuracyEntry = {
  readonly polyOutcome: "up" | "down";
  readonly pythOutcome: "up" | "down";
  readonly absMovePct: number;
};

/**
 * Pure aggregation over a set of (polymarket outcome, pyth outcome,
 * pyth |move%|) tuples. Independent of the DB layer so it can be
 * unit-tested with hand-crafted inputs.
 */
export function aggregateProxyAccuracy({
  entries,
  clearMovePct,
}: {
  readonly entries: readonly ProxyAccuracyEntry[];
  readonly clearMovePct: number;
}): ProxyAccuracyAggregate {
  let agreed = 0;
  let disagreed = 0;
  const disagreementMoves: number[] = [];
  let clearDisagreements = 0;
  let belowClear = 0;
  for (const entry of entries) {
    if (entry.polyOutcome === entry.pythOutcome) {
      agreed += 1;
    } else {
      disagreed += 1;
      disagreementMoves.push(entry.absMovePct);
      if (entry.absMovePct >= clearMovePct) {
        clearDisagreements += 1;
      } else {
        belowClear += 1;
      }
    }
  }
  const total = agreed + disagreed;
  disagreementMoves.sort((a, b) => a - b);

  return {
    total,
    agreed,
    disagreed,
    agreementRate: total === 0 ? null : agreed / total,
    disagreeMeanMovePct: mean(disagreementMoves),
    disagreeMedianMovePct: quantile({ sorted: disagreementMoves, q: 0.5 }),
    disagreeP90MovePct: quantile({ sorted: disagreementMoves, q: 0.9 }),
    clearMovePct,
    clearDisagreements,
    disagreeBelowClearShare: disagreed === 0 ? null : belowClear / disagreed,
    moveBucketsDisagree: histogramByMovePct({ moves: disagreementMoves }),
  };
}

export function histogramByMovePct({
  moves,
}: {
  readonly moves: readonly number[];
}): readonly ProxyMoveBucket[] {
  const counts = new Array<number>(MOVE_BUCKETS_PCT.length).fill(0);
  outer: for (const move of moves) {
    for (let i = 0; i < MOVE_BUCKETS_PCT.length; i++) {
      const upper = MOVE_BUCKETS_PCT[i];
      if (upper === undefined) {
        continue;
      }
      if (upper === null || move < upper) {
        counts[i] = (counts[i] ?? 0) + 1;
        continue outer;
      }
    }
  }
  let prev = 0;
  return MOVE_BUCKETS_PCT.map((upper, i): ProxyMoveBucket => {
    const label = bucketLabel({ lower: prev, upper });
    if (upper !== null) {
      prev = upper;
    }
    return { upperPct: upper, label, count: counts[i] ?? 0 };
  });
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}

function quantile({
  sorted,
  q,
}: {
  readonly sorted: readonly number[];
  readonly q: number;
}): number | null {
  if (sorted.length === 0) {
    return null;
  }
  if (sorted.length === 1) {
    return sorted[0] ?? null;
  }
  const idx = (sorted.length - 1) * q;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const a = sorted[lower];
  const b = sorted[upper];
  if (a === undefined || b === undefined) {
    return null;
  }
  if (lower === upper) {
    return a;
  }
  return a + (b - a) * (idx - lower);
}

function bucketLabel({
  lower,
  upper,
}: {
  readonly lower: number;
  readonly upper: number | null;
}): string {
  const fmt = (pct: number): string => {
    const bp = pct * 100;
    if (Number.isInteger(bp)) {
      return `${bp} bp`;
    }
    return `${bp.toFixed(1)} bp`;
  };
  if (upper === null) {
    return `≥ ${fmt(lower)}`;
  }
  if (lower === 0) {
    return `< ${fmt(upper)}`;
  }
  return `${fmt(lower)}–${fmt(upper)}`;
}
