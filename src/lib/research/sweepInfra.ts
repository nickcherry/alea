import { writeFileSync } from "node:fs";

import { quarterLabelFor, quarterStartFor } from "@alea/lib/backtest/cache";
import { timeframeMs } from "@alea/lib/candles/timeframeMs";
import type { DatabaseClient } from "@alea/lib/db/types";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import { resolveDirectionalOutcome } from "@alea/lib/reliability/resolveDirectionalOutcome";
import type { Asset } from "@alea/types/assets";

const ONE_MINUTE_MS = timeframeMs({ timeframe: "1m" });
const ONE_HOUR_MS = timeframeMs({ timeframe: "1h" });
const DECISION_BEFORE_CLOSE_MS = 10 * ONE_MINUTE_MS;
const DECISION_AFTER_OPEN_MS = ONE_HOUR_MS - DECISION_BEFORE_CLOSE_MS;

export const SWEEP_HISTORY_BARS = 340;
export const SWEEP_DECISION_AFTER_OPEN_MS = DECISION_AFTER_OPEN_MS;
export type SweepDirection = "up" | "down";

export type SweepTargetRecord = {
  readonly asset: Asset;
  readonly quarter: string;
  readonly targetBar: MarketBar;
  readonly syntheticBar: MarketBar;
  readonly history: readonly MarketBar[];
  readonly outcome: SweepDirection;
};

export async function loadSweepTargets({
  db,
  asset,
  startMs,
  endMs,
  historyBars = SWEEP_HISTORY_BARS,
  log,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly startMs: number;
  readonly endMs: number;
  readonly historyBars?: number;
  readonly log?: (line: string) => void;
}): Promise<readonly SweepTargetRecord[]> {
  const historyStartMs = Math.max(0, startMs - historyBars * ONE_HOUR_MS);
  const [hourBars, minuteBars] = await Promise.all([
    loadPythBars({
      db,
      asset,
      timeframe: "1h",
      startMs: historyStartMs,
      endMs,
    }),
    loadPythBars({
      db,
      asset,
      timeframe: "1m",
      startMs,
      endMs,
    }),
  ]);
  const targets: SweepTargetRecord[] = [];
  const firstTargetIndex = lowerBoundOpenTime({
    bars: hourBars,
    openTimeMs: startMs,
  });
  for (let i = firstTargetIndex; i < hourBars.length; i += 1) {
    const targetBar = hourBars[i]!;
    if (targetBar.openTimeMs >= endMs) {
      break;
    }
    const decisionTsMs = targetBar.openTimeMs + DECISION_AFTER_OPEN_MS;
    if (decisionTsMs > endMs) {
      continue;
    }
    const syntheticBar = synthesizePartialBar({
      minuteBars,
      activeOpenTimeMs: targetBar.openTimeMs,
      decisionTsMs,
    });
    if (syntheticBar === null) {
      continue;
    }
    const history = hourBars.slice(Math.max(0, i - historyBars), i);
    if (history.length < 80) {
      continue;
    }
    targets.push({
      asset,
      quarter: quarterLabelFor({
        quarterStartMs: quarterStartFor({ tsMs: targetBar.openTimeMs }),
      }),
      targetBar,
      syntheticBar,
      history,
      outcome: resolveDirectionalOutcome({
        startPrice: targetBar.open,
        endPrice: targetBar.close,
      }),
    });
  }
  log?.(
    JSON.stringify({
      kind: "asset-loaded",
      asset,
      hourBars: hourBars.length,
      minuteBars: minuteBars.length,
      targets: targets.length,
    }),
  );
  return targets;
}

async function loadPythBars({
  db,
  asset,
  timeframe,
  startMs,
  endMs,
}: {
  readonly db: DatabaseClient;
  readonly asset: Asset;
  readonly timeframe: "1m" | "1h";
  readonly startMs: number;
  readonly endMs: number;
}): Promise<readonly MarketBar[]> {
  const rows = await db
    .selectFrom("candles")
    .select(["timestamp", "open", "high", "low", "close", "volume"])
    .where("source", "=", "pyth")
    .where("product", "=", "spot")
    .where("asset", "=", asset)
    .where("timeframe", "=", timeframe)
    .where("timestamp", ">=", new Date(startMs))
    .where("timestamp", "<", new Date(endMs))
    .orderBy("timestamp", "asc")
    .execute();
  return rows.map((row) => ({
    openTimeMs: row.timestamp.getTime(),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  }));
}

function synthesizePartialBar({
  minuteBars,
  activeOpenTimeMs,
  decisionTsMs,
}: {
  readonly minuteBars: readonly MarketBar[];
  readonly activeOpenTimeMs: number;
  readonly decisionTsMs: number;
}): MarketBar | null {
  const start = lowerBoundOpenTime({
    bars: minuteBars,
    openTimeMs: activeOpenTimeMs,
  });
  const usable: MarketBar[] = [];
  for (let i = start; i < minuteBars.length; i += 1) {
    const bar = minuteBars[i]!;
    if (bar.openTimeMs < activeOpenTimeMs) {
      continue;
    }
    if (bar.openTimeMs + ONE_MINUTE_MS > decisionTsMs) {
      break;
    }
    usable.push(bar);
  }
  if (usable.length === 0) {
    return null;
  }
  return {
    openTimeMs: activeOpenTimeMs,
    open: usable[0]!.open,
    high: Math.max(...usable.map((bar) => bar.high)),
    low: Math.min(...usable.map((bar) => bar.low)),
    close: usable.at(-1)!.close,
    volume: usable.reduce((sum, bar) => sum + bar.volume, 0),
  };
}

function lowerBoundOpenTime({
  bars,
  openTimeMs,
}: {
  readonly bars: readonly MarketBar[];
  readonly openTimeMs: number;
}): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (bars[mid]!.openTimeMs < openTimeMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export function parseSweepDateMs(value: string): number {
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) {
    throw new Error(`invalid date: ${value}`);
  }
  return ms;
}

export type SweepBasicStat = {
  n: number;
  wins: number;
  losses: number;
};

export type SweepCandidateStat<Config> = SweepBasicStat & {
  readonly config: Config;
  readonly quarters: Map<string, SweepBasicStat>;
  readonly assets: Map<string, SweepBasicStat>;
};

export function recordSweepDecision<Config>({
  stat,
  asset,
  quarter,
  won,
}: {
  readonly stat: SweepCandidateStat<Config>;
  readonly asset: Asset;
  readonly quarter: string;
  readonly won: boolean;
}): void {
  addBasic({ stat, won });
  addBasic({ stat: getBasic(stat.quarters, quarter), won });
  addBasic({ stat: getBasic(stat.assets, asset), won });
}

function addBasic({
  stat,
  won,
}: {
  readonly stat: SweepBasicStat;
  readonly won: boolean;
}): void {
  stat.n += 1;
  if (won) {
    stat.wins += 1;
  } else {
    stat.losses += 1;
  }
}

function getBasic(
  map: Map<string, SweepBasicStat>,
  key: string,
): SweepBasicStat {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const stat: SweepBasicStat = { n: 0, wins: 0, losses: 0 };
  map.set(key, stat);
  return stat;
}

export function getOrCreateCandidateStat<Config>({
  stats,
  key,
  config,
}: {
  readonly stats: Map<string, SweepCandidateStat<Config>>;
  readonly key: string;
  readonly config: Config;
}): SweepCandidateStat<Config> {
  const existing = stats.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const stat: SweepCandidateStat<Config> = {
    n: 0,
    wins: 0,
    losses: 0,
    config,
    quarters: new Map(),
    assets: new Map(),
  };
  stats.set(key, stat);
  return stat;
}

export type SweepStatSummary<Config> = {
  readonly key: string;
  readonly config: Config;
  readonly decisions: number;
  readonly wins: number;
  readonly losses: number;
  readonly coverage: number;
  readonly winRate: number;
  readonly quarterCount: number;
  readonly coveredQuarters: number;
  readonly positiveQuarters: number;
  readonly minQuarterWinRate: number | null;
  readonly coveredAssets: number;
  readonly positiveAssets: number;
  readonly minAssetWinRate: number | null;
  readonly quarterRates: readonly {
    readonly name: string;
    readonly decisions: number;
    readonly winRate: number | null;
  }[];
  readonly assetRates: readonly {
    readonly name: string;
    readonly decisions: number;
    readonly winRate: number | null;
  }[];
};

export function summarizeSweepStats<Config>({
  stats,
  assets,
  recordCount,
  quarterLabels,
  minDecisions,
  filter = () => true,
}: {
  readonly stats: ReadonlyMap<string, SweepCandidateStat<Config>>;
  readonly assets: readonly Asset[];
  readonly recordCount: number;
  readonly quarterLabels: readonly string[];
  readonly minDecisions: number;
  readonly filter?: (stat: SweepCandidateStat<Config>) => boolean;
}): readonly SweepStatSummary<Config>[] {
  return [...stats.entries()]
    .filter(([, stat]) => stat.n >= minDecisions && filter(stat))
    .map(([key, stat]) =>
      summarizeStat({ key, stat, assets, recordCount, quarterLabels }),
    )
    .sort((a, b) => b.winRate - a.winRate || b.decisions - a.decisions);
}

function summarizeStat<Config>({
  key,
  stat,
  assets,
  recordCount,
  quarterLabels,
}: {
  readonly key: string;
  readonly stat: SweepCandidateStat<Config>;
  readonly assets: readonly Asset[];
  readonly recordCount: number;
  readonly quarterLabels: readonly string[];
}): SweepStatSummary<Config> {
  const quarterRates = quarterLabels.map((name) => {
    const quarter = stat.quarters.get(name);
    return {
      name,
      decisions: quarter?.n ?? 0,
      winRate:
        quarter === undefined || quarter.n === 0
          ? null
          : sweepPct(quarter.wins, quarter.n),
    };
  });
  const assetRates = assets.map((name) => {
    const asset = stat.assets.get(name);
    return {
      name,
      decisions: asset?.n ?? 0,
      winRate:
        asset === undefined || asset.n === 0
          ? null
          : sweepPct(asset.wins, asset.n),
    };
  });
  const coveredQuarters = quarterRates.filter(
    (row) => row.decisions > 0,
  ).length;
  const coveredAssets = assetRates.filter((row) => row.decisions > 0).length;
  const positiveQuarters = quarterRates.filter(
    (row) => row.winRate !== null && row.winRate > 50,
  ).length;
  const positiveAssets = assetRates.filter(
    (row) => row.winRate !== null && row.winRate > 50,
  ).length;
  return {
    key,
    config: stat.config,
    decisions: stat.n,
    wins: stat.wins,
    losses: stat.losses,
    coverage: sweepPct(stat.n, recordCount),
    winRate: sweepPct(stat.wins, stat.n),
    quarterCount: quarterLabels.length,
    coveredQuarters,
    positiveQuarters,
    minQuarterWinRate: minSweepRate(quarterRates),
    coveredAssets,
    positiveAssets,
    minAssetWinRate: minSweepRate(assetRates),
    quarterRates,
    assetRates,
  };
}

function minSweepRate(
  rows: readonly { readonly winRate: number | null }[],
): number | null {
  const rates = rows
    .map((row) => row.winRate)
    .filter((rate): rate is number => rate !== null);
  return rates.length === 0 ? null : Math.min(...rates);
}

export function sweepPct(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function writeSweepArtifact({
  slug,
  payload,
}: {
  readonly slug: string;
  readonly payload: Readonly<Record<string, unknown>>;
}): string {
  const outPath = `doc/results-artifacts/${new Date()
    .toISOString()
    .replaceAll(":", "-")}-${slug}.json`;
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  return outPath;
}
