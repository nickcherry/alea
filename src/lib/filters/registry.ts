import { candidateHash, canonicalJson } from "@alea/lib/filters/hash";
import type { Candidate, Filter } from "@alea/lib/filters/types";

/**
 * The framework's single source of truth for which filter
 * implementations exist. Each entry exposes one `Filter<TConfig>`
 * implementation. The training command iterates this map, calls
 * `defaultCandidates()` on each, and runs every produced candidate
 * across the configured (period × asset) grid.
 *
 * Adding a filter: write one file under `filters/`, export a
 * `Filter<TConfig>` and a `defaultCandidates() => readonly unknown[]`
 * (the list of configs to test by default), then append both to
 * the map below.
 *
 * `Record<filterId, ...>` enforces that the filter object's `id`
 * matches its registry key — a runtime check in
 * `assertRegistryConsistent` catches mismatches.
 */
export type FilterRegistryEntry = {
  readonly filter: Filter<unknown>;
  /**
   * The set of configs to instantiate by default. Each becomes a
   * `Candidate`. The filter's own `configSchema.parse(...)` is
   * applied first so schema defaults take effect.
   */
  readonly defaultConfigs: () => readonly unknown[];
};

const registry: Record<string, FilterRegistryEntry> = {};

export function registerFilter(entry: FilterRegistryEntry): void {
  const id = entry.filter.id;
  if (registry[id] !== undefined) {
    throw new Error(`filter ${id} already registered`);
  }
  registry[id] = entry;
}

export function getFilter(id: string): FilterRegistryEntry | undefined {
  return registry[id];
}

export function allFilters(): readonly FilterRegistryEntry[] {
  return Object.values(registry);
}

/**
 * Produces every `Candidate` declared by the currently registered
 * filters. Each config is parsed through the filter's schema (so
 * defaults are applied and shape is validated) before hashing.
 *
 * Order is `(filterId asc, config-list order)` so reruns produce
 * the same candidate sequence and the training command's progress log
 * is reproducible.
 */
export function allCandidates(): readonly Candidate[] {
  const out: Candidate[] = [];
  const entries = Object.entries(registry).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [id, entry] of entries) {
    for (const rawConfig of entry.defaultConfigs()) {
      const config = entry.filter.configSchema.parse(rawConfig);
      const configCanon = canonicalJson(config);
      const hash = candidateHash({
        filterId: id,
        version: entry.filter.version,
        configCanon,
      });
      out.push({
        filterId: id,
        version: entry.filter.version,
        config,
        configCanon,
        candidateHash: hash,
      });
    }
  }
  return out;
}

/**
 * Used by tests to make assertions deterministic — clears the
 * registry between cases. NEVER call from production code paths.
 */
export function __resetRegistryForTests(): void {
  for (const key of Object.keys(registry)) {
    delete registry[key];
  }
}
