import type { FilterFamily } from "@alea/lib/filters/types";

/**
 * Shared formatting and HTML helpers for Alea dashboard renderers.
 *
 * Every static dashboard page emits HTML server-side via a pure
 * `(payload, assets) -> string` renderer; these helpers centralise the
 * common pieces (escaping, percent/date formatting, win-rate tone
 * thresholds, info tips) so the four renderers stop reimplementing
 * them in lockstep. The browser-side mirrors live in
 * `src/assets/web/alea-utils.js`.
 */

/**
 * Win rate tone bands. A WR in [WR_NEGATIVE_MAX, WR_POSITIVE_MIN) is
 * neutral so we don't tint a 50.4% candidate green. The bands are
 * eyeballed: 52%+ is "edge", below 48% is "anti-edge".
 */
export const WR_POSITIVE_MIN = 0.52;
export const WR_NEGATIVE_MAX = 0.48;

export type WinRateTone = "positive" | "negative" | "neutral";

/** Plain HTML-safe escape. */
export function escapeHtml({ value }: { readonly value: string }): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Escape `<` inside a JSON payload so the embedding
 * `<script type="application/json">…</script>` block stays well-formed.
 * Only the `<` is dangerous in this context; everything else is fine
 * inside an inline JSON script tag.
 */
export function escapeJsonForHtml({
  value,
}: {
  readonly value: string;
}): string {
  return value.replaceAll("<", "\\u003c");
}

/** Decimal 0..1 → "XX.X%". */
export function formatPercent({ value }: { readonly value: number }): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Pretty long-form datetime used in dashboard subtitles. */
export function formatDateTime({ ms }: { readonly ms: number }): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "unknown";
  }
  return new Date(ms).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Underscore-separated regime id → spaced label ("low_vol_ranging" → "low vol ranging"). */
export function formatMarketRegime({
  value,
}: {
  readonly value: string;
}): string {
  return value.replaceAll("_", " ");
}

/** Snake-case filter family id → spaced label ("band_reversion" → "band reversion"). */
export function familyLabel({
  family,
}: {
  readonly family: FilterFamily;
}): string {
  switch (family) {
    case "band_reversion":
      return "band reversion";
    case "oscillator_reversion":
      return "oscillator reversion";
    case "velocity_fade":
      return "velocity fade";
    case "ma_position":
      return "ma position";
    case "pattern":
      return "pattern";
    case "divergence":
      return "divergence";
  }
}

/** Resolve a tone band for a (possibly-missing) win rate. */
export function toneForWinRate({
  value,
}: {
  readonly value: number | null;
}): WinRateTone {
  if (value === null) {
    return "neutral";
  }
  if (value >= WR_POSITIVE_MIN) {
    return "positive";
  }
  if (value < WR_NEGATIVE_MAX) {
    return "negative";
  }
  return "neutral";
}

/**
 * Returns the CSS class suffix to drop onto an inline numeric cell
 * — leading space included so callers can do `class="alea-mono${cls}"`
 * without ternaries. Empty for neutral / null.
 */
export function winRateToneClass({
  value,
}: {
  readonly value: number | null;
}): string {
  const tone = toneForWinRate({ value });
  if (tone === "positive") {
    return " alea-num-positive";
  }
  if (tone === "negative") {
    return " alea-num-negative";
  }
  return "";
}

/** Inline ⓘ info tooltip span. The `alea-info-tooltips.js` script
 *  upgrades it from CSS-only hover to a positioned overlay. */
export function infoTip({ text }: { readonly text: string }): string {
  return ` <span class="alea-info-tip" tabindex="0" data-tip="${escapeHtml({ value: text })}" aria-label="${escapeHtml({ value: text })}"></span>`;
}
