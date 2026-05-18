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

type Trigger = {
  readonly asset: Asset;
  readonly targetTsMs: number;
  readonly direction: "up" | "down";
  readonly won: boolean;
  readonly synthReturnPct: number;
  readonly lastReturnPct: number;
  readonly streakLength: number;
  readonly recentVolPct: number;
  readonly hourOfDay: number;
  readonly btcSynthSameDir: boolean | null;
  readonly btcLastSameDir: boolean | null;
  readonly absSynth: number;
  readonly absLast: number;
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

export const researchExtensionReversalConditioningCommand = defineCommand({
  name: "research:extension-reversal-conditioning",
  summary: "Slice extension-reversal triggers by conditioning features",
  description:
    "Re-runs the Extension Reversal trigger at minSynthReturnPct=0.015, minLastReturnPct=0.005 (broader net than the registered config) and slices the resulting decisions by magnitude, streak length, recent volatility, hour of day, and BTC-cross-alignment to find conditioning rules that lift WR while preserving meaningful decision volume.",
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
    "Prints a multi-section WR breakdown by feature buckets. Writes a JSON artifact with the full per-trigger feature record under doc/results-artifacts.",
  sideEffects: "Reads stored Pyth 1m and 1h candles. Does not write database rows.",
  async run({ io, options }) {
    const assets = (options.assets ??
      TRADE_DECISION_DEFAULT_ASSETS) as readonly Asset[];
    if (options.end <= options.start) {
      throw new Error("--end must be after --start");
    }
    io.writeStdout(
      `${pc.bold("research:extension-reversal-conditioning")} ${pc.dim(`${new Date(options.start).toISOString()} -> ${new Date(options.end).toISOString()}`)} ${pc.dim(`assets=${assets.join(",")}`)}\n`,
    );
    const db = createDatabase();
    try {
      const result = await runConditioning({
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

async function runConditioning({
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

  const btcTargets = await loadSweepTargets({
    db,
    asset: "btc",
    startMs,
    endMs,
    log,
  });
  const btcByTs = new Map<
    number,
    { synthDir: "up" | "down" | "flat"; lastDir: "up" | "down" | "flat" }
  >();
  for (const target of btcTargets) {
    const bars: readonly MarketBar[] = [...target.history, target.syntheticBar];
    const lastIndex = bars.length - 1;
    const synth = bars[lastIndex]!;
    const last = bars[lastIndex - 1]!;
    btcByTs.set(target.targetBar.openTimeMs, {
      synthDir:
        synth.close > synth.open
          ? "up"
          : synth.close < synth.open
            ? "down"
            : "flat",
      lastDir:
        last.close > last.open
          ? "up"
          : last.close < last.open
            ? "down"
            : "flat",
    });
  }

  const triggers: Trigger[] = [];
  const baseConfig = {
    minSynthReturnPct: 0.015,
    minLastReturnPct: 0.005,
    maxSignalAgeBars: 0,
    allowedDirection: "both" as const,
    minStreakLength: 0,
    minConfluenceCount: 0,
    confluenceMinSynthReturnPct: 0,
    confluenceMinLastReturnPct: 0,
  };
  for (const asset of assets) {
    const targets =
      asset === "btc"
        ? btcTargets
        : await loadSweepTargets({ db, asset, startMs, endMs, log });
    for (const target of targets) {
      const bars: readonly MarketBar[] = [
        ...target.history,
        target.syntheticBar,
      ];
      const lastIndex = bars.length - 1;
      const trigger = detectExtensionReversalAt({
        bars,
        index: lastIndex,
        config: baseConfig,
      });
      if (trigger === undefined) {
        continue;
      }
      const streakLength = countConsecutiveSameDirClosed({
        bars,
        startIndex: lastIndex - 1,
        direction: trigger.direction === "up" ? "down" : "up",
      });
      const recentVolPct = recentRealizedVolPct({
        bars,
        endIndex: lastIndex - 1,
        window: 24,
      });
      const hourOfDay = new Date(target.targetBar.openTimeMs).getUTCHours();
      const btc = btcByTs.get(target.targetBar.openTimeMs);
      const extDir = trigger.direction === "up" ? "down" : "up";
      const btcSynthSameDir =
        btc === undefined
          ? null
          : btc.synthDir !== "flat" && btc.synthDir === extDir;
      const btcLastSameDir =
        btc === undefined
          ? null
          : btc.lastDir !== "flat" && btc.lastDir === extDir;
      triggers.push({
        asset,
        targetTsMs: target.targetBar.openTimeMs,
        direction: trigger.direction,
        won: trigger.direction === target.outcome,
        synthReturnPct: trigger.synthReturnPct,
        lastReturnPct: trigger.lastReturnPct,
        streakLength,
        recentVolPct,
        hourOfDay,
        btcSynthSameDir,
        btcLastSameDir,
        absSynth: Math.abs(trigger.synthReturnPct),
        absLast: Math.abs(trigger.lastReturnPct),
      });
    }
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(`Total triggers (broad net): ${triggers.length}`);
  lines.push(`Overall WR: ${pctOf(triggers.filter((t) => t.won).length, triggers.length)}`);
  lines.push("");
  lines.push("=== Per-asset ===");
  for (const asset of assets) {
    const subset = triggers.filter((t) => t.asset === asset);
    lines.push(
      `  ${asset}: n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("");

  lines.push("=== synth magnitude bucket ===");
  for (const lo of [0.015, 0.02, 0.025, 0.03, 0.04, 0.05]) {
    const subset = triggers.filter((t) => t.absSynth >= lo);
    lines.push(
      `  synth>=${lo}: n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("");

  lines.push("=== last-bar magnitude bucket (synth>=0.02) ===");
  for (const lo of [0.005, 0.01, 0.015, 0.02, 0.025, 0.03]) {
    const subset = triggers.filter(
      (t) => t.absSynth >= 0.02 && t.absLast >= lo,
    );
    lines.push(
      `  synth>=0.02 last>=${lo}: n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("");

  lines.push("=== streak length (count of consecutive prior same-dir closed bars) ===");
  for (const len of [0, 1, 2, 3, 4]) {
    const subset = triggers.filter(
      (t) => t.absSynth >= 0.02 && t.streakLength >= len,
    );
    lines.push(
      `  synth>=0.02 streak>=${len}: n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("");

  lines.push("=== recent realized vol regime (24-bar ret-stdev*100) ===");
  const volBuckets = [0, 0.005, 0.01, 0.015, 0.02];
  for (let i = 0; i < volBuckets.length; i += 1) {
    const lo = volBuckets[i]!;
    const hi = volBuckets[i + 1];
    const subset = triggers.filter(
      (t) =>
        t.absSynth >= 0.02 &&
        t.recentVolPct >= lo &&
        (hi === undefined || t.recentVolPct < hi),
    );
    lines.push(
      `  synth>=0.02 vol in [${lo}, ${hi ?? "inf"}): n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("");

  lines.push("=== per-direction ===");
  for (const dir of ["up", "down"] as const) {
    const subset = triggers.filter(
      (t) => t.absSynth >= 0.02 && t.direction === dir,
    );
    lines.push(
      `  bet ${dir} (extension ${dir === "up" ? "down" : "up"}): n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("");

  lines.push("=== hour of day (UTC, decision fires at HH:45 of previous hour) ===");
  for (let h = 0; h < 24; h += 1) {
    const subset = triggers.filter(
      (t) => t.absSynth >= 0.02 && t.hourOfDay === h,
    );
    if (subset.length === 0) continue;
    lines.push(
      `  target.open UTC ${String(h).padStart(2, "0")}:00: n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("");

  lines.push("=== BTC-cross alignment for alts (excludes BTC itself) ===");
  for (const sameDir of [true, false] as const) {
    const subset = triggers.filter(
      (t) =>
        t.asset !== "btc" &&
        t.absSynth >= 0.02 &&
        t.btcSynthSameDir === sameDir,
    );
    lines.push(
      `  alt + BTC synth same-extension-dir=${sameDir}: n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  for (const sameDir of [true, false] as const) {
    const subset = triggers.filter(
      (t) =>
        t.asset !== "btc" &&
        t.absSynth >= 0.02 &&
        t.btcLastSameDir === sameDir,
    );
    lines.push(
      `  alt + BTC last same-extension-dir=${sameDir}: n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("");

  lines.push("=== combo: synth>=0.02 + streak>=2 + vol>=0.01 ===");
  {
    const subset = triggers.filter(
      (t) => t.absSynth >= 0.02 && t.streakLength >= 2 && t.recentVolPct >= 0.01,
    );
    lines.push(
      `  n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("=== combo: synth>=0.025 + last>=0.015 ===");
  {
    const subset = triggers.filter(
      (t) => t.absSynth >= 0.025 && t.absLast >= 0.015,
    );
    lines.push(
      `  n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("=== combo: synth>=0.025 + last>=0.015 + streak>=2 ===");
  {
    const subset = triggers.filter(
      (t) =>
        t.absSynth >= 0.025 && t.absLast >= 0.015 && t.streakLength >= 2,
    );
    lines.push(
      `  n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("=== combo: synth>=0.03 + last>=0.02 ===");
  {
    const subset = triggers.filter(
      (t) => t.absSynth >= 0.03 && t.absLast >= 0.02,
    );
    lines.push(
      `  n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("");

  lines.push("=== LONG-ONLY (bet up after down-extension) sweeps ===");
  const longOnly = triggers.filter((t) => t.direction === "up");
  lines.push(
    `  baseline: n=${longOnly.length} WR=${pctOf(longOnly.filter((t) => t.won).length, longOnly.length)}`,
  );
  for (const lo of [0.015, 0.02, 0.025, 0.03, 0.04]) {
    const subset = longOnly.filter((t) => t.absSynth >= lo);
    lines.push(
      `  long synth>=${lo}: n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  for (const lo of [0.005, 0.01, 0.015, 0.02]) {
    const subset = longOnly.filter(
      (t) => t.absSynth >= 0.02 && t.absLast >= lo,
    );
    lines.push(
      `  long synth>=0.02 last>=${lo}: n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  for (const streak of [1, 2, 3]) {
    const subset = longOnly.filter(
      (t) => t.absSynth >= 0.02 && t.absLast >= 0.01 && t.streakLength >= streak,
    );
    lines.push(
      `  long synth>=0.02 last>=0.01 streak>=${streak}: n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push(
    `  long synth>=0.02 streak>=2 vol>=0.01: n=${longOnly.filter((t) => t.absSynth >= 0.02 && t.streakLength >= 2 && t.recentVolPct >= 0.01).length} WR=${pctOf(
      longOnly.filter((t) => t.absSynth >= 0.02 && t.streakLength >= 2 && t.recentVolPct >= 0.01 && t.won).length,
      longOnly.filter((t) => t.absSynth >= 0.02 && t.streakLength >= 2 && t.recentVolPct >= 0.01).length,
    )}`,
  );
  lines.push("");

  lines.push("=== LONG-ONLY per-asset (synth>=0.02 last>=0.01) ===");
  for (const asset of assets) {
    const subset = longOnly.filter(
      (t) => t.asset === asset && t.absSynth >= 0.02 && t.absLast >= 0.01,
    );
    lines.push(
      `  ${asset}: n=${subset.length} WR=${pctOf(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("");

  lines.push("=== LONG-ONLY per-quarter (synth>=0.02 last>=0.01) ===");
  const longSubset = longOnly.filter(
    (t) => t.absSynth >= 0.02 && t.absLast >= 0.01,
  );
  const byQuarter = new Map<string, Trigger[]>();
  for (const t of longSubset) {
    const d = new Date(t.targetTsMs);
    const q = `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    if (!byQuarter.has(q)) byQuarter.set(q, []);
    byQuarter.get(q)!.push(t);
  }
  for (const q of [...byQuarter.keys()].sort()) {
    const arr = byQuarter.get(q)!;
    lines.push(
      `  ${q}: n=${arr.length} WR=${pctOf(arr.filter((t) => t.won).length, arr.length)}`,
    );
  }
  lines.push("");

  lines.push("=== LONG-ONLY + BTC same-extension (alts only) ===");
  const longAltsBtcAligned = longOnly.filter(
    (t) =>
      t.asset !== "btc" &&
      t.absSynth >= 0.02 &&
      t.absLast >= 0.01 &&
      t.btcSynthSameDir === true,
  );
  const longBtc = longOnly.filter(
    (t) => t.asset === "btc" && t.absSynth >= 0.02 && t.absLast >= 0.01,
  );
  const longCombined = [...longBtc, ...longAltsBtcAligned];
  lines.push(
    `  btc+aligned-alts: n=${longCombined.length} WR=${pctOf(longCombined.filter((t) => t.won).length, longCombined.length)}`,
  );

  const outPath = writeSweepArtifact({
    slug: "one-hour-extension-reversal-conditioning",
    payload: {
      generatedAt: new Date().toISOString(),
      runtimeMs: Date.now() - started,
      startMs,
      endMs,
      assets,
      triggers,
    },
  });
  return { summary: `${lines.join("\n")}\n`, outPath };
}

function countConsecutiveSameDirClosed({
  bars,
  startIndex,
  direction,
}: {
  readonly bars: readonly MarketBar[];
  readonly startIndex: number;
  readonly direction: "up" | "down";
}): number {
  let count = 0;
  for (let i = startIndex; i >= 0; i -= 1) {
    const bar = bars[i];
    if (bar === undefined) break;
    const dir =
      bar.close > bar.open ? "up" : bar.close < bar.open ? "down" : "flat";
    if (dir !== direction) break;
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

function pctOf(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}
