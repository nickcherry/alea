/**
 * For each (asset, 5m window) in the 14h window, compute:
 *   - is there a SOURCE MISMATCH (any of binance/perp, binance/spot,
 *     coinbase/perp, coinbase/spot disagrees with chainlink on the
 *     winning side)?
 *   - did we TRADE (production data from the dashboard)?
 *   - if traded, did we WIN or LOSE?
 *
 * Reports the 3-way breakdown the operator asked for: of the
 * mismatch windows, what % did we trade-and-lose, trade-and-win,
 * not-trade.
 */
import { createDatabase } from "@alea/lib/db/createDatabase";
import { sql } from "kysely";

const dashPath = "/tmp/dash.json";
const replayPath =
  "/Users/nickcherry/src/alea/tmp/replay-trading/replay-trading_2026-05-08T12-56-43.772Z.jsonl";

const dash = await Bun.file(dashPath).json();
const nowMs = dash.generatedAtMs;
const cutoff = nowMs - 14 * 3600 * 1000;

// Production trade outcomes keyed by (asset, windowStartMs)
type ProdOutcome = "win" | "loss";
const prodByKey = new Map<string, ProdOutcome>();
for (const m of dash.markets) {
  if (!m.lastActivityAtMs || m.lastActivityAtMs < cutoff) continue;
  const slug = m.slug ?? "";
  const sm = slug.match(/-(\d+)$/);
  if (!sm) continue;
  const windowStart = Number(sm[1]) * 1000;
  const asset = m.symbol.toLowerCase();
  if (m.result === "win" || m.result === "loss") {
    prodByKey.set(`${asset}:${windowStart}`, m.result);
  }
}

// Chainlink + line outcomes from replay JSONL — covers EVERY window in
// the requested range, not just our trades.
type Cell = {
  asset: string;
  windowStartMs: number;
  chainlinkLine: number;
  chainlinkSide: "up" | "down";
  polymarketSide: "up" | "down" | null;
};
const cells: Cell[] = [];
const lines = (await Bun.file(replayPath).text()).split("\n").filter(Boolean);
for (const ln of lines) {
  const obj = JSON.parse(ln);
  if (obj.type !== "window_finalized") continue;
  const cl = obj.replayChainlink ?? {};
  for (const [asset, slot] of Object.entries(cl)) {
    const o = (slot as { outcome?: any }).outcome;
    if (!o) continue;
    cells.push({
      asset,
      windowStartMs: obj.windowStartMs,
      chainlinkLine: o.chainlinkLine,
      chainlinkSide: o.winningSide,
      polymarketSide: o.polymarketResolution?.winningSide ?? null,
    });
  }
}
console.log(`replay cells (asset × window): ${cells.length}`);

// Per-source closes from candles table
const db = createDatabase();
type SourceCloseRow = {
  asset: string;
  windowStartMs: number;
  source: string;
  product: string;
  close: number;
};
let closes: SourceCloseRow[] = [];
try {
  const r = await sql<{
    asset: string;
    ts_ms: string;
    source: string;
    product: string;
    close: number;
  }>`SELECT asset, source, product, EXTRACT(EPOCH FROM timestamp) * 1000 AS ts_ms, close
       FROM candles
       WHERE timeframe = '5m' AND timestamp >= to_timestamp(${cutoff / 1000})`.execute(
    db,
  );
  closes = r.rows.map((row) => ({
    asset: row.asset,
    windowStartMs: Number(row.ts_ms),
    source: row.source,
    product: row.product,
    close: Number(row.close),
  }));
  console.log(`candles closes loaded: ${closes.length}`);
} finally {
  await db.destroy();
}

const closeMap = new Map<string, number>();
for (const r of closes) {
  closeMap.set(
    `${r.asset}:${r.windowStartMs}:${r.source}/${r.product}`,
    r.close,
  );
}

// Compute mismatch per cell, then categorise outcome
type Outcome = "trade-loss" | "trade-win" | "no-trade";
let nMismatch = 0;
const mismatchOutcomes = { "trade-loss": 0, "trade-win": 0, "no-trade": 0 };
const cleanOutcomes = { "trade-loss": 0, "trade-win": 0, "no-trade": 0 };
for (const c of cells) {
  const truth = c.polymarketSide ?? c.chainlinkSide;
  let mismatch = false;
  for (const sp of ["binance/perp", "binance/spot", "coinbase/perp", "coinbase/spot"]) {
    const close = closeMap.get(`${c.asset}:${c.windowStartMs}:${sp}`);
    if (close === undefined) continue;
    const side = close >= c.chainlinkLine ? "up" : "down";
    if (side !== truth) {
      mismatch = true;
      break;
    }
  }
  const traded = prodByKey.get(`${c.asset}:${c.windowStartMs}`);
  const outcome: Outcome =
    traded === "win"
      ? "trade-win"
      : traded === "loss"
        ? "trade-loss"
        : "no-trade";
  if (mismatch) {
    nMismatch += 1;
    mismatchOutcomes[outcome] += 1;
  } else {
    cleanOutcomes[outcome] += 1;
  }
}

const nClean = cells.length - nMismatch;
console.log(`\n=== outcomes for ALL (asset × window) cells over 14h ===`);
console.log(`total cells:        ${cells.length}`);
console.log(`source mismatches:  ${nMismatch} (${((nMismatch / cells.length) * 100).toFixed(1)}%)`);
console.log(`source clean:       ${nClean} (${((nClean / cells.length) * 100).toFixed(1)}%)`);
console.log();
console.log(`MISMATCH cells (n=${nMismatch}) — what did we do?`);
for (const [k, v] of Object.entries(mismatchOutcomes)) {
  const pct = nMismatch > 0 ? (v / nMismatch) * 100 : 0;
  console.log(`  ${k.padEnd(12)} ${v.toString().padStart(4)}  (${pct.toFixed(1)}%)`);
}
console.log();
console.log(`CLEAN cells (n=${nClean}) — what did we do?`);
for (const [k, v] of Object.entries(cleanOutcomes)) {
  const pct = nClean > 0 ? (v / nClean) * 100 : 0;
  console.log(`  ${k.padEnd(12)} ${v.toString().padStart(4)}  (${pct.toFixed(1)}%)`);
}

console.log();
console.log(`=== conditional win rates ===`);
const mismatchTraded = mismatchOutcomes["trade-win"] + mismatchOutcomes["trade-loss"];
const cleanTraded = cleanOutcomes["trade-win"] + cleanOutcomes["trade-loss"];
console.log(
  `  trades on MISMATCH cells: ${mismatchTraded}, win-rate ${
    mismatchTraded > 0 ? ((mismatchOutcomes["trade-win"] / mismatchTraded) * 100).toFixed(1) : "n/a"
  }%`,
);
console.log(
  `  trades on CLEAN    cells: ${cleanTraded}, win-rate ${
    cleanTraded > 0 ? ((cleanOutcomes["trade-win"] / cleanTraded) * 100).toFixed(1) : "n/a"
  }%`,
);
