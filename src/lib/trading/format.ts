/**
 * Money + percent formatters shared across the trading CLI commands
 * (`trading:performance`, `trading:hydrate-lifetime-pnl`) and the
 * trading-performance dashboard. Lives here rather than under
 * `src/lib/cli/` because the conventions are trading-specific (signed
 * PnL, percent with one decimal); other domains can have their own.
 */

/**
 * Money formatter. `signed = true` (default) prefixes "+" or "-" on
 * non-zero values; pass `signed: false` for absolute amounts (cost
 * basis, lifetime totals where direction is implicit). Always two
 * decimals.
 */
export function formatUsd({
  value,
  signed = true,
}: {
  readonly value: number;
  readonly signed?: boolean;
}): string {
  if (!signed || value === 0) {
    return `$${Math.abs(value).toFixed(2)}`;
  }
  const sign = value > 0 ? "+" : "-";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

/**
 * Percent formatter. `null` (e.g. denominator-zero) renders as `--`;
 * otherwise one decimal place. Input is a fraction in [0, 1], not a
 * pre-multiplied percentage.
 */
export function formatPercent({
  value,
}: {
  readonly value: number | null;
}): string {
  return value === null ? "--" : `${(value * 100).toFixed(1)}%`;
}
