import { createHash } from "node:crypto";

import type {
  FilterCandidate,
  FilterConfig,
  TradingFilter,
} from "@alea/lib/filters/types";

export function defineCandidate<const Config extends FilterConfig>({
  filter,
  config,
  takeProfitPct,
  stopLossPct,
  outcomeWindowBars,
}: {
  readonly filter: TradingFilter<Config>;
  readonly config: Config;
  readonly takeProfitPct: number;
  readonly stopLossPct: number;
  readonly outcomeWindowBars: number;
}): FilterCandidate<Config> {
  validateTradeProfile({ takeProfitPct, stopLossPct, outcomeWindowBars });
  const configCanon = canonicalizeConfig({
    config,
    takeProfitPct,
    stopLossPct,
    outcomeWindowBars,
  });
  const configHash = hashConfigCanon({ configCanon });
  return {
    id: `${filter.id}@v${filter.version}:${configHash}`,
    filterId: filter.id,
    filterName: filter.name,
    filterVersion: filter.version,
    description: filter.description,
    sources: filter.sources,
    config,
    configCanon,
    configHash,
    takeProfitPct,
    stopLossPct,
    outcomeWindowBars,
    evaluate: (context) => filter.evaluate({ ...context, config }),
  };
}

function validateTradeProfile({
  takeProfitPct,
  stopLossPct,
  outcomeWindowBars,
}: {
  readonly takeProfitPct: number;
  readonly stopLossPct: number;
  readonly outcomeWindowBars: number;
}): void {
  if (!Number.isFinite(takeProfitPct) || takeProfitPct <= 0) {
    throw new Error("takeProfitPct must be a positive finite number");
  }
  if (!Number.isFinite(stopLossPct) || stopLossPct <= 0) {
    throw new Error("stopLossPct must be a positive finite number");
  }
  if (!Number.isInteger(outcomeWindowBars) || outcomeWindowBars <= 0) {
    throw new Error("outcomeWindowBars must be a positive integer");
  }
}

export function canonicalizeConfig({
  config,
  takeProfitPct,
  stopLossPct,
  outcomeWindowBars,
}: {
  readonly config: unknown;
  readonly takeProfitPct: number;
  readonly stopLossPct: number;
  readonly outcomeWindowBars: number;
}): string {
  return JSON.stringify(
    sortJson({
      config,
      takeProfitPct,
      stopLossPct,
      outcomeWindowBars,
    }),
  );
}

function hashConfigCanon({
  configCanon,
}: {
  readonly configCanon: string;
}): string {
  return createHash("sha256").update(configCanon).digest("hex").slice(0, 16);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortJson((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
