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

type AssetTrigger = {
  readonly asset: Asset;
  readonly targetTsMs: number;
  readonly won: boolean;
  readonly synthRet: number;
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

export const researchMultiAssetConfluenceCommand = defineCommand({
  name: "research:multi-asset-confluence",
  summary: "Check whether simultaneous long-bias triggers across assets lift WR",
  description:
    "For each target candle timestamp, counts how many of the 5 assets simultaneously fire a long-only Extension Reversal trigger (synth down, last down, both above thresholds). Reports WR conditioned on N=1, 2, 3+ simultaneous-asset triggers — bets up on each triggering asset. The hypothesis is that broad-market downside extensions revert more reliably than idiosyncratic ones.",
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
    defineValueOption({
      key: "synth",
      long: "--synth",
      valueName: "PCT",
      schema: z
        .string()
        .optional()
        .transform((v) => (v === undefined ? 0.02 : parseFloat(v)))
        .describe("Minimum |synth ret|. Defaults to 0.02."),
    }),
    defineValueOption({
      key: "last",
      long: "--last",
      valueName: "PCT",
      schema: z
        .string()
        .optional()
        .transform((v) => (v === undefined ? 0.01 : parseFloat(v)))
        .describe("Minimum |last ret|. Defaults to 0.01."),
    }),
  ],
  output:
    "Prints WR for each simultaneous-asset count (1, 2, 3+). Writes a JSON artifact under doc/results-artifacts.",
  sideEffects: "Reads stored Pyth 1m and 1h candles. Does not write database rows.",
  async run({ io, options }) {
    const assets = (options.assets ??
      TRADE_DECISION_DEFAULT_ASSETS) as readonly Asset[];
    if (options.end <= options.start) {
      throw new Error("--end must be after --start");
    }
    io.writeStdout(
      `${pc.bold("research:multi-asset-confluence")} ${pc.dim(`${new Date(options.start).toISOString()} -> ${new Date(options.end).toISOString()}`)} ${pc.dim(`assets=${assets.join(",")} synth=${options.synth} last=${options.last}`)}\n`,
    );
    const db = createDatabase();
    try {
      const result = await runConfluence({
        db,
        assets,
        startMs: options.start,
        endMs: options.end,
        synthThreshold: options.synth,
        lastThreshold: options.last,
        log: (line) => io.writeStdout(`${line}\n`),
      });
      io.writeStdout(result.summary);
      io.writeStdout(`\n${pc.dim(`artifact: ${result.outPath}`)}\n`);
    } finally {
      await destroyDatabase(db);
    }
  },
});

async function runConfluence({
  db,
  assets,
  startMs,
  endMs,
  synthThreshold,
  lastThreshold,
  log,
}: {
  readonly db: DatabaseClient;
  readonly assets: readonly Asset[];
  readonly startMs: number;
  readonly endMs: number;
  readonly synthThreshold: number;
  readonly lastThreshold: number;
  readonly log: (line: string) => void;
}): Promise<{ readonly summary: string; readonly outPath: string }> {
  const started = Date.now();
  const triggers: AssetTrigger[] = [];
  for (const asset of assets) {
    const targets = await loadSweepTargets({ db, asset, startMs, endMs, log });
    for (const target of targets) {
      const bars: readonly MarketBar[] = [
        ...target.history,
        target.syntheticBar,
      ];
      const lastIndex = bars.length - 1;
      const trigger = detectExtensionReversalAt({
        bars,
        index: lastIndex,
        config: {
          minSynthReturnPct: synthThreshold,
          minLastReturnPct: lastThreshold,
          maxSignalAgeBars: 0,
          allowedDirection: "up",
          minStreakLength: 0,
          minConfluenceCount: 0,
          confluenceMinSynthReturnPct: 0,
          confluenceMinLastReturnPct: 0,
        },
      });
      if (trigger !== undefined) {
        triggers.push({
          asset,
          targetTsMs: target.targetBar.openTimeMs,
          won: target.outcome === "up",
          synthRet: trigger.synthReturnPct,
        });
      }
    }
  }

  const byTimestamp = new Map<number, AssetTrigger[]>();
  for (const t of triggers) {
    if (!byTimestamp.has(t.targetTsMs)) {
      byTimestamp.set(t.targetTsMs, []);
    }
    byTimestamp.get(t.targetTsMs)!.push(t);
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(`Total long-only triggers: ${triggers.length}`);
  lines.push(`Distinct timestamps with triggers: ${byTimestamp.size}`);
  lines.push("");

  const fmt = (n: number, w: number) => n.toFixed(2).padStart(w);
  const pct = (num: number, den: number) =>
    den === 0 ? "  n/a" : fmt((num / den) * 100, 5) + "%";

  lines.push("=== Cohorts by simultaneous-asset count ===");
  for (const minCount of [1, 2, 3, 4, 5]) {
    const filteredTriggers = triggers.filter((t) => {
      const cohort = byTimestamp.get(t.targetTsMs)!;
      return cohort.length >= minCount;
    });
    lines.push(
      `  count >= ${minCount}: n=${String(filteredTriggers.length).padStart(5)}  WR=${pct(
        filteredTriggers.filter((t) => t.won).length,
        filteredTriggers.length,
      )}`,
    );
  }
  for (const exactCount of [1, 2, 3, 4, 5]) {
    const filteredTriggers = triggers.filter((t) => {
      const cohort = byTimestamp.get(t.targetTsMs)!;
      return cohort.length === exactCount;
    });
    lines.push(
      `  count == ${exactCount}: n=${String(filteredTriggers.length).padStart(5)}  WR=${pct(
        filteredTriggers.filter((t) => t.won).length,
        filteredTriggers.length,
      )}`,
    );
  }
  lines.push("");

  lines.push("=== Per asset (existing baseline) ===");
  for (const asset of assets) {
    const subset = triggers.filter((t) => t.asset === asset);
    lines.push(
      `  ${asset}: n=${String(subset.length).padStart(4)}  WR=${pct(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("");

  lines.push("=== Per asset, only when count >= 2 simultaneous ===");
  for (const asset of assets) {
    const subset = triggers.filter((t) => {
      if (t.asset !== asset) return false;
      const cohort = byTimestamp.get(t.targetTsMs)!;
      return cohort.length >= 2;
    });
    lines.push(
      `  ${asset}: n=${String(subset.length).padStart(4)}  WR=${pct(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("");

  lines.push("=== Per asset, only when count >= 3 simultaneous ===");
  for (const asset of assets) {
    const subset = triggers.filter((t) => {
      if (t.asset !== asset) return false;
      const cohort = byTimestamp.get(t.targetTsMs)!;
      return cohort.length >= 3;
    });
    lines.push(
      `  ${asset}: n=${String(subset.length).padStart(4)}  WR=${pct(subset.filter((t) => t.won).length, subset.length)}`,
    );
  }
  lines.push("");

  lines.push("=== Recent (2025+) cohorts by simultaneous-asset count ===");
  const recent = triggers.filter(
    (t) => t.targetTsMs >= Date.UTC(2025, 0, 1),
  );
  const recentByTs = new Map<number, AssetTrigger[]>();
  for (const t of recent) {
    if (!recentByTs.has(t.targetTsMs)) recentByTs.set(t.targetTsMs, []);
    recentByTs.get(t.targetTsMs)!.push(t);
  }
  for (const minCount of [1, 2, 3]) {
    const sub = recent.filter(
      (t) => recentByTs.get(t.targetTsMs)!.length >= minCount,
    );
    lines.push(
      `  count >= ${minCount}: n=${String(sub.length).padStart(4)}  WR=${pct(
        sub.filter((t) => t.won).length,
        sub.length,
      )}`,
    );
  }

  const outPath = writeSweepArtifact({
    slug: "one-hour-multi-asset-confluence",
    payload: {
      generatedAt: new Date().toISOString(),
      runtimeMs: Date.now() - started,
      startMs,
      endMs,
      assets,
      synthThreshold,
      lastThreshold,
      triggerCount: triggers.length,
      triggers,
    },
  });
  return { summary: `${lines.join("\n")}\n`, outPath };
}
