import { createHash } from "node:crypto";

import type { TradeDecisionPeriod } from "@alea/constants/tradeDecision";
import type { FilterCandidate } from "@alea/lib/filters/types";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import type { Asset } from "@alea/types/assets";

export type CandidateBacktestCacheInput = {
  readonly candidate: FilterCandidate;
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
  readonly source: "pyth";
  readonly quarterStartMs: number;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly decisionSchemaVersion: number;
  readonly engineVersion: number;
  readonly leadTimeMs: number;
  readonly hydrateBars: number;
  readonly inputDataHash: string;
};

export function candidateBacktestCacheHash(
  input: CandidateBacktestCacheInput,
): string {
  return createHash("sha256")
    .update(candidateBacktestCachePayload(input))
    .digest("hex")
    .slice(0, 32);
}

export function candidateBacktestCachePayload({
  candidate,
  asset,
  period,
  source,
  quarterStartMs,
  windowStartMs,
  windowEndMs,
  decisionSchemaVersion,
  engineVersion,
  leadTimeMs,
  hydrateBars,
  inputDataHash,
}: CandidateBacktestCacheInput): string {
  return JSON.stringify({
    asset,
    candidateId: candidate.id,
    configCanon: candidate.configCanon,
    configHash: candidate.configHash,
    decisionSchemaVersion,
    engineVersion,
    filterId: candidate.filterId,
    filterVersion: candidate.filterVersion,
    hydrateBars,
    inputDataHash,
    leadTimeMs,
    period,
    quarterStartMs,
    source,
    windowEndMs,
    windowStartMs,
  });
}

export function candidateBacktestInputDataHash({
  periodBars,
  minuteBars,
  periodStartMs,
  minuteStartMs,
  windowEndMs,
}: {
  readonly periodBars: readonly MarketBar[];
  readonly minuteBars: readonly MarketBar[];
  readonly periodStartMs: number;
  readonly minuteStartMs: number;
  readonly windowEndMs: number;
}): string {
  const hash = createHash("sha256");
  updateBarHash({
    hash,
    label: "period",
    bars: periodBars,
    startMs: periodStartMs,
    endMs: windowEndMs,
  });
  updateBarHash({
    hash,
    label: "minute",
    bars: minuteBars,
    startMs: minuteStartMs,
    endMs: windowEndMs,
  });
  return hash.digest("hex").slice(0, 32);
}

export function quarterStartFor({ tsMs }: { readonly tsMs: number }): number {
  const date = new Date(tsMs);
  const year = date.getUTCFullYear();
  const quarterMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  return Date.UTC(year, quarterMonth, 1);
}

export function quarterEndFor({
  quarterStartMs,
}: {
  readonly quarterStartMs: number;
}): number {
  const date = new Date(quarterStartMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, 1);
}

export function quarterLabelFor({
  quarterStartMs,
}: {
  readonly quarterStartMs: number;
}): string {
  const date = new Date(quarterStartMs);
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()} Q${quarter}`;
}

export function quarterWindowFor({
  quarterStartMs,
  startMs,
  endMs,
}: {
  readonly quarterStartMs: number;
  readonly startMs: number;
  readonly endMs: number;
}): {
  readonly windowStartMs: number;
  readonly windowEndMs: number;
} {
  return {
    windowStartMs: Math.max(startMs, quarterStartMs),
    windowEndMs: Math.min(endMs, quarterEndFor({ quarterStartMs })),
  };
}

function updateBarHash({
  hash,
  label,
  bars,
  startMs,
  endMs,
}: {
  readonly hash: ReturnType<typeof createHash>;
  readonly label: string;
  readonly bars: readonly MarketBar[];
  readonly startMs: number;
  readonly endMs: number;
}): void {
  hash.update(`${label}:`);
  for (const bar of bars) {
    if (bar.openTimeMs < startMs || bar.openTimeMs >= endMs) {
      continue;
    }
    hash.update(
      `${bar.openTimeMs},${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume};`,
    );
  }
}
