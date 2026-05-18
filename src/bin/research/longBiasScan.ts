import { CANDIDATE_BACKTEST_START_MS } from "@alea/constants/backtest";
import { TRADE_DECISION_DEFAULT_ASSETS } from "@alea/constants/tradeDecision";
import { defineCommand } from "@alea/lib/cli/defineCommand";
import { defineValueOption } from "@alea/lib/cli/defineValueOption";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import type { DatabaseClient } from "@alea/lib/db/types";
import { detectExtensionReversalAt } from "@alea/lib/filters/extensionReversalCore";
import type { MarketBar } from "@alea/lib/marketSeries/types";
import {
  loadSweepTargets,
  parseSweepDateMs,
  writeSweepArtifact,
} from "@alea/lib/research/sweepInfra";
import type { Asset } from "@alea/types/assets";
import pc from "picocolors";
import { z } from "zod";

type DecisionPoint = {
  readonly asset: Asset;
  readonly targetTsMs: number;
  readonly won: boolean;
  readonly synthRet: number;
  readonly lastRet: number;
  readonly cum2: number;
  readonly cum3: number;
  readonly cum4: number;
  readonly redStreak: number;
  readonly lastCloseLoc: number;
  readonly recentVolPct: number;
  readonly distFromHigh20: number;
  readonly rsi14: number | null;
  readonly extensionReversalFires: boolean;
};

const assetSchema = z.enum(TRADE_DECISION_DEFAULT_ASSETS);
const commaSeparatedAssetsSchema = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined
      ? undefined
      : value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(assetSchema).min(1).optional());

export const researchLongBiasScanCommand = defineCommand({
  name: "research:long-bias-scan",
  summary: "Scan simple long-bias triggers for uncorrelated signals",
  description:
    "For each target candle, computes a rich feature set on the input bars (synth ret, multi-bar cumulative returns, red-streak length, RSI, distance-from-high, realized vol) and the outcome (target up/down). Reports WR for many simple long-bias triggers and overlap with the registered Extension Reversal filter. Use to find candidate triggers that fire when Extension Reversal doesn't and still beat the base rate when betting UP.",
  options: [
    defineValueOption({
      key: "assets",
      long: "--assets",
      valueName: "LIST",
      schema: commaSeparatedAssetsSchema.describe(
        `Comma-separated assets. Defaults to ${TRADE_DECISION_DEFAULT_ASSETS.join(",")}.`,
      ),
    }),
    defineValueOption({
      key: "start",
      long: "--start",
      valueName: "YYYY-MM-DD",
      schema: z
        .string()
        .optional()
        .transform((value) =>
          value === undefined
            ? CANDIDATE_BACKTEST_START_MS
            : parseSweepDateMs(value),
        )
        .describe("Inclusive UTC start date."),
    }),
    defineValueOption({
      key: "end",
      long: "--end",
      valueName: "YYYY-MM-DD",
      schema: z
        .string()
        .optional()
        .transform((value) =>
          value === undefined ? Date.now() : parseSweepDateMs(value),
        )
        .describe("Exclusive UTC end date. Defaults to now."),
    }),
  ],
  output:
    "Prints WR breakdowns for many long-bias triggers and their overlap with Extension Reversal v2. Writes a JSON artifact with per-decision-point feature record under doc/results-artifacts.",
  sideEffects: "Reads stored Pyth 1m and 1h candles. Does not write database rows.",
  async run({ io, options }) {
    const assets = (options.assets ??
      TRADE_DECISION_DEFAULT_ASSETS) as readonly Asset[];
    if (options.end <= options.start) {
      throw new Error("--end must be after --start");
    }
    io.writeStdout(
      `${pc.bold("research:long-bias-scan")} ${pc.dim(`${new Date(options.start).toISOString()} -> ${new Date(options.end).toISOString()}`)} ${pc.dim(`assets=${assets.join(",")}`)}\n`,
    );
    const db = createDatabase();
    try {
      const result = await runScan({
        db,
        assets,
        startMs: options.start,
        endMs: options.end,
        log: (line) => io.writeStdout(`${line}\n`),
      });
      io.writeStdout(result.summary);
      io.writeStdout(`\n${pc.dim(`artifact: ${result.outPath}`)}\n`);
    } finally {
      await destroyDatabase(db);
    }
  },
});

async function runScan({
  db,
  assets,
  startMs,
  endMs,
  log,
}: {
  readonly db: DatabaseClient;
  readonly assets: readonly Asset[];
  readonly startMs: number;
  readonly endMs: number;
  readonly log: (line: string) => void;
}): Promise<{ readonly summary: string; readonly outPath: string }> {
  const started = Date.now();
  const points: DecisionPoint[] = [];

  for (const asset of assets) {
    const targets = await loadSweepTargets({ db, asset, startMs, endMs, log });
    for (const target of targets) {
      const bars: readonly MarketBar[] = [
        ...target.history,
        target.syntheticBar,
      ];
      const lastIndex = bars.length - 1;
      const synth = bars[lastIndex]!;
      const last1 = bars[lastIndex - 1]!;
      const last2 = bars[lastIndex - 2];
      const last3 = bars[lastIndex - 3];
      const last4 = bars[lastIndex - 4];
      if (last1 === undefined || synth.open <= 0 || last1.open <= 0) {
        continue;
      }
      const synthRet = (synth.close - synth.open) / synth.open;
      const lastRet = (last1.close - last1.open) / last1.open;
      const cum2 =
        last2 === undefined ? 0 : (last1.close - last2.open) / last2.open;
      const cum3 =
        last3 === undefined ? 0 : (last1.close - last3.open) / last3.open;
      const cum4 =
        last4 === undefined ? 0 : (last1.close - last4.open) / last4.open;
      const redStreak = countLeadingRed({ bars, startIndex: lastIndex - 1 });
      const lastCloseLoc =
        last1.high === last1.low
          ? 0.5
          : (last1.close - last1.low) / (last1.high - last1.low);
      const recentVolPct = recentRealizedVolPct({
        bars,
        endIndex: lastIndex - 1,
        window: 24,
      });
      const distFromHigh20 = distanceFromHigh({
        bars,
        endIndex: lastIndex - 1,
        window: 20,
      });
      const rsi14 = rsi({ bars, endIndex: lastIndex - 1, period: 14 });
      const extensionReversalFires =
        detectExtensionReversalAt({
          bars,
          index: lastIndex,
          config: {
            minSynthReturnPct: 0.02,
            minLastReturnPct: 0.01,
            maxSignalAgeBars: 0,
            allowedDirection: "up",
            minStreakLength: 0,
            minConfluenceCount: 0,
            confluenceMinSynthReturnPct: 0,
            confluenceMinLastReturnPct: 0,
          },
        }) !== undefined;
      points.push({
        asset,
        targetTsMs: target.targetBar.openTimeMs,
        won: target.outcome === "up",
        synthRet,
        lastRet,
        cum2,
        cum3,
        cum4,
        redStreak,
        lastCloseLoc,
        recentVolPct,
        distFromHigh20,
        rsi14,
        extensionReversalFires,
      });
    }
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(`Decision points scanned: ${points.length}`);
  lines.push(
    `Base rate (always-up): ${pctOf(points.filter((p) => p.won).length, points.length)}`,
  );
  lines.push("");

  const report = (label: string, predicate: (p: DecisionPoint) => boolean) => {
    const fires = points.filter(predicate);
    const wins = fires.filter((p) => p.won).length;
    const overlap = fires.filter((p) => p.extensionReversalFires).length;
    const newPoints = fires.length - overlap;
    const newWins = fires.filter(
      (p) => !p.extensionReversalFires && p.won,
    ).length;
    lines.push(
      `${label.padEnd(60)} n=${String(fires.length).padStart(5)} WR=${pctOf(wins, fires.length).padStart(7)}  overlap=${overlap}  new=${newPoints} newWR=${pctOf(newWins, newPoints).padStart(7)}`,
    );
  };

  lines.push("=== Cum N-bar drawdown (bet up) ===");
  for (const t of [0.01, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05]) {
    report(`cum2 <= -${t}`, (p) => p.cum2 <= -t);
  }
  for (const t of [0.015, 0.02, 0.025, 0.03, 0.04, 0.05]) {
    report(`cum3 <= -${t}`, (p) => p.cum3 <= -t);
  }
  for (const t of [0.02, 0.025, 0.03, 0.04, 0.05, 0.06]) {
    report(`cum4 <= -${t}`, (p) => p.cum4 <= -t);
  }
  lines.push("");

  lines.push("=== Red streak (bet up) ===");
  for (const k of [2, 3, 4, 5]) {
    report(`redStreak >= ${k}`, (p) => p.redStreak >= k);
  }
  lines.push("");

  lines.push("=== Last bar capitulation (down with close near low) ===");
  for (const r of [0.01, 0.015, 0.02, 0.025]) {
    for (const cl of [0.25, 0.2, 0.15]) {
      report(
        `lastRet <= -${r} AND closeLoc <= ${cl}`,
        (p) => p.lastRet <= -r && p.lastCloseLoc <= cl,
      );
    }
  }
  lines.push("");

  lines.push("=== RSI oversold ===");
  for (const t of [25, 30, 35, 40]) {
    report(`RSI14 <= ${t}`, (p) => p.rsi14 !== null && p.rsi14 <= t);
  }
  for (const t of [25, 30, 35]) {
    report(
      `RSI14 <= ${t} AND lastRet <= -0.005`,
      (p) => p.rsi14 !== null && p.rsi14 <= t && p.lastRet <= -0.005,
    );
  }
  lines.push("");

  lines.push("=== Distance below 20-bar high ===");
  for (const d of [0.03, 0.05, 0.08, 0.1, 0.15]) {
    report(
      `distFromHigh20 >= ${d}`,
      (p) => p.distFromHigh20 >= d,
    );
  }
  for (const d of [0.05, 0.08, 0.1]) {
    report(
      `distFromHigh20 >= ${d} AND lastRet <= -0.005`,
      (p) => p.distFromHigh20 >= d && p.lastRet <= -0.005,
    );
  }
  lines.push("");

  lines.push("=== Combos: synth UP after pullback (different from Extension Reversal which fires on synth DOWN) ===");
  for (const t of [0.015, 0.02, 0.025]) {
    for (const c of [0.02, 0.03, 0.04]) {
      report(
        `synth >= ${t} AND cum3 <= -${c}`,
        (p) => p.synthRet >= t && p.cum3 <= -c,
      );
    }
  }
  lines.push("");

  lines.push("=== Combos: deep pullback + low vol (capitulation in calm regime) ===");
  for (const c of [0.02, 0.03, 0.04]) {
    report(
      `cum3 <= -${c} AND vol < 0.01`,
      (p) => p.cum3 <= -c && p.recentVolPct < 0.01,
    );
  }
  lines.push("");

  lines.push("=== Top long-bias triggers (>=200 trades, >=58% WR), excluding Extension Reversal overlap ===");
  const candidates: Array<{ label: string; predicate: (p: DecisionPoint) => boolean }> = [];
  for (const t of [0.015, 0.02, 0.025, 0.03]) {
    candidates.push({
      label: `cum2 <= -${t}`,
      predicate: (p) => p.cum2 <= -t,
    });
    candidates.push({
      label: `cum3 <= -${t}`,
      predicate: (p) => p.cum3 <= -t,
    });
  }
  for (const k of [2, 3, 4]) {
    candidates.push({
      label: `redStreak >= ${k}`,
      predicate: (p) => p.redStreak >= k,
    });
  }
  for (const r of [0.01, 0.015, 0.02]) {
    for (const cl of [0.2, 0.25]) {
      candidates.push({
        label: `lastRet <= -${r} AND closeLoc <= ${cl}`,
        predicate: (p) => p.lastRet <= -r && p.lastCloseLoc <= cl,
      });
    }
  }
  const ranked = candidates
    .map((c) => {
      const fires = points.filter(c.predicate);
      const newPoints = fires.filter((p) => !p.extensionReversalFires);
      return {
        label: c.label,
        nNew: newPoints.length,
        wrNew:
          newPoints.length === 0
            ? 0
            : (newPoints.filter((p) => p.won).length / newPoints.length) * 100,
      };
    })
    .filter((r) => r.nNew >= 100)
    .sort((a, b) => b.wrNew - a.wrNew)
    .slice(0, 15);
  for (const r of ranked) {
    lines.push(
      `  ${r.label.padEnd(50)} n=${String(r.nNew).padStart(5)} WR=${r.wrNew.toFixed(2)}%`,
    );
  }

  const outPath = writeSweepArtifact({
    slug: "one-hour-long-bias-scan",
    payload: {
      generatedAt: new Date().toISOString(),
      runtimeMs: Date.now() - started,
      startMs,
      endMs,
      assets,
      pointCount: points.length,
      points,
    },
  });
  return { summary: `${lines.join("\n")}\n`, outPath };
}

function countLeadingRed({
  bars,
  startIndex,
}: {
  readonly bars: readonly MarketBar[];
  readonly startIndex: number;
}): number {
  let count = 0;
  for (let i = startIndex; i >= 0; i -= 1) {
    const bar = bars[i];
    if (bar === undefined) break;
    if (bar.close >= bar.open) break;
    count += 1;
  }
  return count;
}

function recentRealizedVolPct({
  bars,
  endIndex,
  window,
}: {
  readonly bars: readonly MarketBar[];
  readonly endIndex: number;
  readonly window: number;
}): number {
  const start = Math.max(0, endIndex - window + 1);
  const returns: number[] = [];
  for (let i = start; i <= endIndex; i += 1) {
    const bar = bars[i];
    if (bar === undefined || bar.open <= 0) continue;
    returns.push((bar.close - bar.open) / bar.open);
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

function distanceFromHigh({
  bars,
  endIndex,
  window,
}: {
  readonly bars: readonly MarketBar[];
  readonly endIndex: number;
  readonly window: number;
}): number {
  const start = Math.max(0, endIndex - window + 1);
  let high = 0;
  for (let i = start; i <= endIndex; i += 1) {
    const bar = bars[i];
    if (bar === undefined) continue;
    if (bar.high > high) high = bar.high;
  }
  const last = bars[endIndex];
  if (last === undefined || high <= 0) return 0;
  return (high - last.close) / high;
}

function rsi({
  bars,
  endIndex,
  period,
}: {
  readonly bars: readonly MarketBar[];
  readonly endIndex: number;
  readonly period: number;
}): number | null {
  const start = endIndex - period;
  if (start < 0) return null;
  let gains = 0;
  let losses = 0;
  for (let i = start + 1; i <= endIndex; i += 1) {
    const prev = bars[i - 1];
    const cur = bars[i];
    if (prev === undefined || cur === undefined) return null;
    const change = cur.close - prev.close;
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (gains + losses === 0) return 50;
  const rs = gains / Math.max(losses, 1e-9);
  return 100 - 100 / (1 + rs);
}

function pctOf(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}
