import { readFile } from "node:fs/promises";

import type { CalibrationOrder } from "@alea/lib/trading/replay/calibration/calibrateEvRrGate";
import type { LeadingSide } from "@alea/lib/trading/types";
import { type Asset, assetSchema } from "@alea/types/assets";

/**
 * Reads a `trading:replay` (or `trading:dry-run`) JSONL session and
 * returns the calibration-relevant projection of every finalized
 * order: the chosen side, the model's probability, the taker book-
 * walk economics, and the venue-truth outcome.
 *
 * Orders without a usable `takerCounterfactual` are dropped (we
 * can't score them as a taker entry). Orders without a resolved
 * venue-truth outcome are kept with `winningSide: null` so they
 * count in the `orderCount` stat but are filtered out by
 * `evaluateGateCell` — that lets the operator see "out of N orders,
 * M were resolvable" without losing visibility into the unresolved
 * tail.
 *
 * Treats malformed lines as soft errors (skipped, returned in
 * `parseErrors`) rather than aborting the whole run, matching the
 * dry-run report parser's behaviour.
 */
export type LoadCalibrationOrdersResult = {
  readonly orders: readonly CalibrationOrder[];
  readonly parseErrors: readonly string[];
  readonly sessionConfig: SessionConfigSummary | null;
};

export type SessionConfigSummary = {
  readonly fromMs: number | null;
  readonly toMs: number | null;
  readonly minEdge: number | null;
  readonly stakeUsd: number | null;
  readonly assets: readonly Asset[];
};

export async function loadCalibrationOrdersFromFile({
  path,
}: {
  readonly path: string;
}): Promise<LoadCalibrationOrdersResult> {
  const raw = await readFile(path, "utf8");
  return loadCalibrationOrdersFromText({ text: raw });
}

export function loadCalibrationOrdersFromText({
  text,
}: {
  readonly text: string;
}): LoadCalibrationOrdersResult {
  const lines = text.split("\n").filter((line) => line.length > 0);
  const orders: CalibrationOrder[] = [];
  const parseErrors: string[] = [];
  let sessionConfig: SessionConfigSummary | null = null;
  for (const [index, line] of lines.entries()) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      parseErrors.push(
        `line ${index + 1}: invalid JSON (${(error as Error).message})`,
      );
      continue;
    }
    const obj = asRecord(record);
    if (obj === null) {
      continue;
    }
    const type = stringField({ obj, key: "type" });
    if (type === "session_start") {
      sessionConfig = parseSessionConfig(obj["config"]);
      continue;
    }
    if (type !== "window_finalized" && type !== "window_checkpoint") {
      continue;
    }
    const orderRecords = arrayField({ obj, key: "orders" });
    for (const [j, raw] of orderRecords.entries()) {
      const order = parseCalibrationOrder({ value: raw });
      if (order !== null) {
        orders.push(order);
      } else {
        // Light parse-error trail — most "skipped" orders are
        // fine (just have no taker counterfactual or no resolved
        // outcome), so we don't count those as errors.
        const orderObj = asRecord(raw);
        if (orderObj === null) {
          parseErrors.push(
            `line ${index + 1} order ${j + 1}: not an object`,
          );
        }
      }
    }
  }
  return { orders, parseErrors, sessionConfig };
}

function parseCalibrationOrder({
  value,
}: {
  readonly value: unknown;
}): CalibrationOrder | null {
  const obj = asRecord(value);
  if (obj === null) {
    return null;
  }
  const assetParse = assetSchema.safeParse(obj["asset"]);
  if (!assetParse.success) {
    return null;
  }
  const side = leadingSideField({ obj, key: "side" });
  if (side === null) {
    return null;
  }
  const modelProbability = numberField({ obj, key: "modelProbability" });
  if (modelProbability === null) {
    return null;
  }
  const taker = parseTakerCounterfactual({
    value: obj["takerCounterfactual"],
  });
  if (taker === null) {
    return null;
  }
  const winningSide = parseWinningSide({ obj });
  return {
    asset: assetParse.data,
    side,
    modelProbability,
    taker,
    winningSide,
  };
}

function parseTakerCounterfactual({
  value,
}: {
  readonly value: unknown;
}): CalibrationOrder["taker"] | null {
  const obj = asRecord(value);
  if (obj === null) {
    return null;
  }
  // The replay JSONL writes the depth-weighted average price under
  // either `askPrice` (legacy) or `avgPrice` (newer). Try both.
  const fillPrice =
    numberField({ obj, key: "avgPrice" }) ??
    numberField({ obj, key: "askPrice" });
  const sharesIfFilled = numberField({ obj, key: "sharesIfFilled" });
  const costUsd = numberField({ obj, key: "costUsd" });
  if (
    fillPrice === null ||
    sharesIfFilled === null ||
    costUsd === null ||
    fillPrice <= 0 ||
    fillPrice >= 1 ||
    sharesIfFilled <= 0 ||
    costUsd <= 0
  ) {
    return null;
  }
  return { fillPrice, sharesIfFilled, costUsd };
}

/**
 * Pull the venue-truth winning side from the order's outcome
 * fields. Replay JSONL stores both chainlink-derived
 * (`replayOutcome.winningSide`) and polymarket-resolved
 * (`officialOutcome`) data; chainlink is the truth source per the
 * runner's docstring, with polymarket as a fallback.
 */
function parseWinningSide({
  obj,
}: {
  readonly obj: Record<string, unknown>;
}): LeadingSide | null {
  const replayOutcome = asRecord(obj["replayOutcome"]);
  if (replayOutcome !== null) {
    const side = leadingSideField({ obj: replayOutcome, key: "winningSide" });
    if (side !== null) {
      return side;
    }
  }
  return leadingSideField({ obj, key: "officialOutcome" });
}

function parseSessionConfig(value: unknown): SessionConfigSummary | null {
  const obj = asRecord(value);
  if (obj === null) {
    return null;
  }
  const replay = asRecord(obj["replay"]);
  const fromMs = replay !== null ? numberField({ obj: replay, key: "fromMs" }) : null;
  const toMs = replay !== null ? numberField({ obj: replay, key: "toMs" }) : null;
  const minEdge = numberField({ obj, key: "minEdge" });
  const stakeUsd = numberField({ obj, key: "stakeUsd" });
  const assetsRaw = arrayField({ obj, key: "assets" });
  const assets = assetsRaw
    .map((entry) => assetSchema.safeParse(entry))
    .filter((entry) => entry.success)
    .map((entry) => entry.data);
  return { fromMs, toMs, minEdge, stakeUsd, assets };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringField({
  obj,
  key,
}: {
  readonly obj: Record<string, unknown>;
  readonly key: string;
}): string | null {
  const value = obj[key];
  return typeof value === "string" ? value : null;
}

function numberField({
  obj,
  key,
}: {
  readonly obj: Record<string, unknown>;
  readonly key: string;
}): number | null {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayField({
  obj,
  key,
}: {
  readonly obj: Record<string, unknown>;
  readonly key: string;
}): readonly unknown[] {
  const value = obj[key];
  return Array.isArray(value) ? value : [];
}

function leadingSideField({
  obj,
  key,
}: {
  readonly obj: Record<string, unknown>;
  readonly key: string;
}): LeadingSide | null {
  const value = obj[key];
  if (value === "up" || value === "down") {
    return value;
  }
  return null;
}
