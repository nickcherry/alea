/**
 * For every (asset, 5m window) in the captured window, compare each
 * candle source's "winning side" (close >= chainlinkLine ? "up" : "down")
 * against chainlink's own winning side. Counts how often each source
 * is a faithful proxy for what Polymarket actually settles on.
 *
 * Reads chainlink line/close from the latest replay JSONL (which already
 * walks every window in the range and emits replayChainlink per asset)
 * and pulls candle closes from the candles table.
 */
import { createDatabase } from "@alea/lib/db/createDatabase";
import { sql } from "kysely";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const replayDir = "/Users/nickcherry/src/alea/tmp/replay-trading";
const sessions = readdirSync(replayDir)
  .filter((f) => /^replay-trading_.*\.jsonl$/.test(f))
  .map((f) => resolve(replayDir, f))
  .map((p) => ({ path: p, mtime: statSync(p).mtimeMs, size: statSync(p).size }))
  .sort((a, b) => b.mtime - a.mtime);
const sessionPath = sessions[0]?.path;
if (!sessionPath) throw new Error("no replay session found");
console.log(`session: ${sessionPath}`);

type Cell = {
  asset: string;
  windowStartMs: number;
  chainlinkLine: number;
  chainlinkSide: "up" | "down";
};
const cells: Cell[] = [];
const text = await Bun.file(sessionPath).text();
for (const line of text.split("\n").filter(Boolean)) {
  const obj = JSON.parse(line);
  if (obj.type !== "window_finalized") continue;
  const cl = obj.replayChainlink ?? {};
  for (const [asset, slot] of Object.entries(cl)) {
    const o = (slot as { outcome?: any }).outcome;
    if (!o || o.chainlinkLine === undefined || !o.winningSide) continue;
    cells.push({
      asset,
      windowStartMs: obj.windowStartMs,
      chainlinkLine: o.chainlinkLine,
      chainlinkSide: o.winningSide,
    });
  }
}
console.log(`cells (asset × 5m window): ${cells.length}`);
const minWindow = Math.min(...cells.map((c) => c.windowStartMs));
const maxWindow = Math.max(...cells.map((c) => c.windowStartMs));
console.log(`range: ${new Date(minWindow).toISOString()} → ${new Date(maxWindow).toISOString()}`);
console.log(`hours: ${((maxWindow - minWindow) / 3600000).toFixed(1)}`);

const db = createDatabase();
const closeMap = new Map<string, number>();
try {
  const rows = await sql<{
    asset: string;
    ts_ms: string;
    source: string;
    product: string;
    close: number;
  }>`SELECT asset, source, product, EXTRACT(EPOCH FROM timestamp) * 1000 AS ts_ms, close
       FROM candles
       WHERE timeframe = '5m' AND timestamp >= to_timestamp(${minWindow / 1000}) AND timestamp <= to_timestamp(${maxWindow / 1000})`.execute(
    db,
  );
  for (const r of rows.rows) {
    closeMap.set(
      `${r.asset}:${Number(r.ts_ms)}:${r.source}/${r.product}`,
      Number(r.close),
    );
  }
  console.log(`candle closes loaded: ${closeMap.size}`);
} finally {
  await db.destroy();
}

const sources = [
  "binance/perp",
  "binance/spot",
  "coinbase/perp",
  "coinbase/spot",
  "coindesk/spot",
  "pyth/spot",
] as const;
const total: Record<string, number> = {};
const disagree: Record<string, number> = {};
const byAssetDisagree: Record<string, Record<string, number>> = {};
const byAssetTotal: Record<string, Record<string, number>> = {};
for (const s of sources) {
  total[s] = 0;
  disagree[s] = 0;
}

for (const c of cells) {
  byAssetTotal[c.asset] ??= {};
  byAssetDisagree[c.asset] ??= {};
  for (const sp of sources) {
    const close = closeMap.get(`${c.asset}:${c.windowStartMs}:${sp}`);
    if (close === undefined) continue;
    const side = close >= c.chainlinkLine ? "up" : "down";
    total[sp]! += 1;
    byAssetTotal[c.asset]![sp] = (byAssetTotal[c.asset]![sp] ?? 0) + 1;
    if (side !== c.chainlinkSide) {
      disagree[sp]! += 1;
      byAssetDisagree[c.asset]![sp] =
        (byAssetDisagree[c.asset]![sp] ?? 0) + 1;
    }
  }
}

console.log(`\n=== source vs chainlink disagreement (all assets, all windows) ===`);
for (const sp of sources) {
  const tot = total[sp]!;
  const dis = disagree[sp]!;
  console.log(
    `  ${sp.padEnd(15)} ${dis}/${tot}  (${((dis / tot) * 100).toFixed(2)}%)`,
  );
}

console.log(`\n=== per-asset breakdown ===`);
for (const asset of Object.keys(byAssetTotal).sort()) {
  console.log(`  ${asset.toUpperCase()}:`);
  for (const sp of sources) {
    const tot = byAssetTotal[asset]?.[sp] ?? 0;
    const dis = byAssetDisagree[asset]?.[sp] ?? 0;
    if (tot === 0) continue;
    console.log(
      `    ${sp.padEnd(15)} ${dis}/${tot}  (${((dis / tot) * 100).toFixed(2)}%)`,
    );
  }
}
