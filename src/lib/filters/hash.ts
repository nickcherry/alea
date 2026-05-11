import { createHash } from "node:crypto";

import type { Asset } from "@alea/types/assets";
import type { CandleTimeframe } from "@alea/types/candles";

/**
 * Canonical JSON stringification with sorted object keys at every
 * depth. Two configs that differ only in key order serialise to the
 * same string here — which keeps the resulting hash stable under
 * "I refactored a config builder to emit fields in a different
 * order."
 *
 * Arrays preserve order (because order is semantic for arrays).
 * Numbers are emitted by `JSON.stringify`'s default rules; we don't
 * try to canonicalise `1.0` vs `1` etc. — Zod's `parse` always
 * normalises configs through the schema before we hash, so the
 * upstream coercion is what enforces shape.
 *
 * Doesn't support cycles or non-JSON values (Date, undefined, etc).
 * Filter configs are required to be pure JSON-serialisable for this
 * reason.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`,
  );
  return `{${entries.join(",")}}`;
}

/**
 * Stable, deterministic hex hash for `(filterId, version, configCanon)`.
 * Used as the candidate's identity. Truncated to 16 chars — collision
 * risk over a few hundred candidates is negligible and the shorter
 * string is friendlier in `filter_runs.run_hash` (which appends
 * period+asset to this and then re-hashes).
 */
export function candidateHash({
  filterId,
  version,
  configCanon,
}: {
  readonly filterId: string;
  readonly version: number;
  readonly configCanon: string;
}): string {
  return createHash("sha256")
    .update(`${filterId}\0${version}\0${configCanon}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * `(candidate, period, asset)` → row primary key in `filter_runs`.
 * Composing the candidate hash with period+asset (rather than
 * re-hashing all 5 fields) lets a debugger see "this row is
 * candidate H on 5m/btc" by inspection.
 */
export function runHash({
  candidateHash: ch,
  period,
  asset,
}: {
  readonly candidateHash: string;
  readonly period: CandleTimeframe;
  readonly asset: Asset;
}): string {
  return createHash("sha256")
    .update(`${ch}\0${period}\0${asset}`)
    .digest("hex")
    .slice(0, 16);
}
