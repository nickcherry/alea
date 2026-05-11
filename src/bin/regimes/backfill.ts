import { defineCommand } from "@alea/lib/cli/defineCommand";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import type { FilterBar } from "@alea/lib/filters/types";
import { classifyMarketRegime } from "@alea/lib/regime/classify";
import { sql } from "kysely";
import pc from "picocolors";

/**
 * One-time backfill that classifies the market regime of every
 * (asset, period, ts_ms) bar in the canonical pyth-spot candles
 * series and persists the result to `bar_regimes`. The exploration
 * aggregator joins this table against `filter_engagements` to
 * stratify a filter's engagements by the regime the market was in when
 * it engaged — letting the dashboard show, per filter, "55 % overall
 * but 62 % in low-vol-ranging, 47 % in high-vol-trending".
 *
 * The classifier itself lives in `lib/regime/classify.ts` and is
 * shared with the live dry-run loop. Running it once per bar in TS
 * costs ~1k ops per bar (~80 sliding 20-bar vol windows for the
 * baseline median, plus an O(20) linreg slope and ATR); on the
 * ~1.6M bars currently in `candles` that lands well under a
 * minute.
 *
 * Idempotent: `on conflict do update` overwrites any existing tag
 * for the bar so re-runs after a classifier change refresh tags in
 * place.
 */
export const regimesBackfillCommand = defineCommand({
  name: "regimes:backfill",
  summary:
    "Classify every (asset, period, ts_ms) bar and write tags to bar_regimes",
  description:
    "Walks each (asset, period) candle series in chronological order, runs `classifyMarketRegime` on a trailing window, and upserts the result into `bar_regimes`. Bars at the very start of an asset's history return null (insufficient lookback) and are stored as null so we can still see they were considered.",
  options: [],
  examples: ["bun alea regimes:backfill"],
  output: "Per-(asset, period) progress lines + a final summary count.",
  sideEffects: "Reads `candles`, writes (upserts) into `bar_regimes`.",
  async run({ io }) {
    io.writeStdout(`${pc.bold("regimes:backfill")}\n\n`);
    const db = createDatabase();
    try {
      const series = await db
        .selectFrom("candles")
        .select(["asset", "timeframe"])
        .where("source", "=", "pyth")
        .where("product", "=", "spot")
        .where("timeframe", "in", ["5m", "15m"])
        .groupBy(["asset", "timeframe"])
        .orderBy("asset", "asc")
        .orderBy("timeframe", "asc")
        .execute();
      let totalRows = 0;
      let totalClassified = 0;
      for (const s of series) {
        io.writeStdout(
          `${pc.bold(s.asset.padEnd(5))} ${pc.dim(s.timeframe.padEnd(4))} `,
        );
        const bars = await db
          .selectFrom("candles")
          .select(["timestamp", "open", "high", "low", "close"])
          .where("source", "=", "pyth")
          .where("product", "=", "spot")
          .where("asset", "=", s.asset)
          .where("timeframe", "=", s.timeframe)
          .orderBy("timestamp", "asc")
          .execute();
        const bufferAsBars: FilterBar[] = bars.map((r) => ({
          openTimeMs:
            r.timestamp instanceof Date
              ? r.timestamp.getTime()
              : new Date(r.timestamp).getTime(),
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
          volume: 0,
        }));
        // Classify each bar with all bars up to and including it.
        const tags: Array<{
          asset: string;
          period: string;
          ts_ms: number;
          market_regime: string | null;
        }> = [];
        // The classifier only reads the trailing `BASELINE_BARS`
        // window, so we pass at most that many. Slicing the whole
        // prefix every iteration would make the backfill quadratic
        // in series length.
        const WINDOW = 100;
        for (let i = 0; i < bufferAsBars.length; i++) {
          const start = Math.max(0, i + 1 - WINDOW);
          const slice = bufferAsBars.slice(start, i + 1);
          const regime = classifyMarketRegime({ bars: slice });
          tags.push({
            asset: s.asset,
            period: s.timeframe,
            ts_ms: bufferAsBars[i]!.openTimeMs,
            market_regime: regime,
          });
        }
        // Bulk insert in chunks. Postgres has a hard limit on
        // parameters per statement (~65535), and Kysely binds 4 per
        // row, so a 5k-row chunk leaves comfortable headroom.
        const CHUNK = 5000;
        for (let i = 0; i < tags.length; i += CHUNK) {
          const slice = tags.slice(i, i + CHUNK);
          await db
            .insertInto("bar_regimes")
            .values(slice)
            .onConflict((oc) =>
              oc.columns(["asset", "period", "ts_ms"]).doUpdateSet({
                market_regime: (eb) => eb.ref("excluded.market_regime"),
              }),
            )
            .execute();
        }
        const classified = tags.filter((t) => t.market_regime !== null).length;
        totalRows += tags.length;
        totalClassified += classified;
        io.writeStdout(
          `${pc.green(tags.length.toLocaleString())} bars, ${classified.toLocaleString()} classified\n`,
        );
      }
      // Per-regime spot-check so the operator can sanity-read the
      // distribution before kicking off downstream consumers.
      const breakdown = await sql<{
        market_regime: string | null;
        count: string;
      }>`
        select market_regime, count(*)::text as count
        from bar_regimes
        group by market_regime
        order by count desc
      `.execute(db);
      io.writeStdout(
        `\n${pc.bold("total")} ${totalRows.toLocaleString()} bars (${totalClassified.toLocaleString()} classified)\n`,
      );
      for (const r of breakdown.rows) {
        io.writeStdout(
          `  ${pc.dim(r.market_regime ?? "—")}: ${Number(r.count).toLocaleString()}\n`,
        );
      }
    } finally {
      await destroyDatabase(db);
    }
  },
});
