import { createHash } from "node:crypto";

import type {
  FilterCandidate,
  FilterConfig,
  TradingFilter,
} from "@alea/lib/filters/types";

export function defineCandidate<const Config extends FilterConfig>({
  filter,
  config,
}: {
  readonly filter: TradingFilter<Config>;
  readonly config: Config;
}): FilterCandidate<Config> {
  const configCanon = canonicalizeConfig(config);
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
    evaluate: (context) => filter.evaluate({ ...context, config }),
  };
}

export function canonicalizeConfig(value: unknown): string {
  return JSON.stringify(sortJson(value));
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
