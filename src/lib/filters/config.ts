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
}: {
  readonly filter: TradingFilter<Config>;
  readonly config: Config;
  readonly takeProfitPct: number;
  readonly stopLossPct: number;
}): FilterCandidate<Config> {
  validateTradeProfile({ takeProfitPct, stopLossPct });
  const configCanon = canonicalizeConfig({ config, takeProfitPct, stopLossPct });
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
    evaluate: (context) => filter.evaluate({ ...context, config }),
  };
}

function validateTradeProfile({
  takeProfitPct,
  stopLossPct,
}: {
  readonly takeProfitPct: number;
  readonly stopLossPct: number;
}): void {
  if (!Number.isFinite(takeProfitPct) || takeProfitPct <= 0) {
    throw new Error("takeProfitPct must be a positive finite number");
  }
  if (!Number.isFinite(stopLossPct) || stopLossPct <= 0) {
    throw new Error("stopLossPct must be a positive finite number");
  }
}

export function canonicalizeConfig({
  config,
  takeProfitPct,
  stopLossPct,
}: {
  readonly config: unknown;
  readonly takeProfitPct: number;
  readonly stopLossPct: number;
}): string {
  return JSON.stringify(
    sortJson({
      config,
      takeProfitPct,
      stopLossPct,
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
