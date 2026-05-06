import {
  LEADING_REGIME_MIN_LEAD_PP,
  LIVE_TRADING_REGIME_ALGOS,
  REGIME_CELL_MIN_SAMPLES,
} from "@alea/constants/trading";
import { MIN_ACTIONABLE_DISTANCE_BP } from "@alea/constants/trading";
import type { RegimeAlgoResult } from "@alea/lib/training/regimeAlgos/resultTypes";
import type {
  AssetRegimeAlgos,
  AssetSizeDistribution,
  AssetSurvivalDistribution,
  AssetSurvivalFilters,
  SurvivalFilterResultPayload,
  SurvivalRemainingMinutes,
  SurvivalSurfaceWithCount,
  TrainingDistributionsPayload,
} from "@alea/lib/training/types";
import {
  aleaBrandMark,
  aleaChartTokens,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";

/**
 * Regime-algo id whose per-regime probability surfaces the live trader
 * actually uses (see `computeAssetProbabilities.ts`). The dashboard
 * surfaces this with a "LIVE" badge so the operator can tell at a
 * glance which sections correspond to production models. Sourced
 * from the same `LIVE_TRADING_REGIME_ALGOS` list the trading layer
 * reads, so the badges can never lie about which algos are live.
 *
 * The legacy filter sections are still rendered for diagnostic
 * comparison; none of them carries the LIVE badge anymore.
 */
const LIVE_TRADING_ALGO_IDS: ReadonlySet<string> = new Set(
  LIVE_TRADING_REGIME_ALGOS.map((a) => a.id),
);


/**
 * Hard cap on the x-axis range for the survival chart, in basis points.
 * The chart auto-fits to the largest distance any line actually reaches
 * (after the sample-count floor cuts off the noisy tail) plus a small
 * pad, so most asset/filter combinations end well below this — the cap
 * is just a sanity ceiling.
 */
const SURVIVAL_MAX_DISTANCE_BP = 75;

/**
 * Padding (bp) added to the right edge after auto-fitting the chart to
 * the data. Keeps the rightmost line away from the axis without leaving
 * the wasteland of empty space we had at the fixed 75bp cap.
 */
const SURVIVAL_X_AXIS_PAD_BP = 2;

/**
 * Color per remaining-minutes line. Cooler/blue for 4m-left (far from
 * settlement, where survival is hardest to call) → warmer/gold for 1m-left
 * (sharp "point of no return"). Matches the visual intuition that less
 * time = more decisive curve.
 */
const SURVIVAL_REMAINING_COLORS: Readonly<
  Record<SurvivalRemainingMinutes, string>
> = {
  4: "#5b95ff",
  3: "#46c37b",
  2: "#ffa566",
  1: "#d7aa45",
};

/**
 * Order in which the remaining-minutes lines are stacked in the chart's
 * series array, the legend, and the table rows. Chart series are drawn
 * later-on-top, so 1m-left (the most decisive curve) ends up on top.
 */
const SURVIVAL_REMAINING_ORDER: readonly SurvivalRemainingMinutes[] = [
  4, 3, 2, 1,
];

/**
 * Three-way color scheme for filter mini-charts. Baseline is muted ivory
 * (the reference everyone reads against). True/false leaning on the
 * existing green/red semantics — green = aligned/positive, red = against.
 * Same hues used in the table delta arrows.
 */
const FILTER_COLORS = {
  baseline: "#b8aa8a",
  whenTrue: "#46c37b",
  whenFalse: "#d85a4f",
} as const;

/**
 * Color scheme for the delta-from-baseline charts. Line strokes are a
 * non-green/red pair (cool blue for true, warm gold for false) so that
 * the green/red fill semantic — green above the neutral line, red below
 * — never collides with the line color. The line just identifies which
 * half; the fill carries "is this slice above or below baseline?".
 */
const DELTA_COLORS = {
  trueLine: "#5b95ff",
  falseLine: "#d7aa45",
  fillAbove: { r: 70, g: 195, b: 123 },
  fillBelow: { r: 216, g: 90, b: 79 },
  zeroRule: "rgba(215, 170, 69, 0.45)",
} as const;

type DashboardAssetSlice = {
  readonly asset: string;
  readonly assetUpper: string;
  readonly candleCount: number;
  readonly yearRange: string | null;
  readonly survival: SurvivalSlice | null;
  readonly regimes: readonly RegimeAlgoSlice[];
  readonly filters: readonly FilterSlice[];
};

/**
 * Per-algo data for one asset, server-rendered into a static HTML
 * block (no per-tab JS reflow needed). The renderer stamps these as
 * pre-built `<details>` strings into the asset panel's regime host on
 * tab switch.
 */
type RegimeAlgoSlice = {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly params: Readonly<Record<string, number>>;
  readonly snapshotsTotal: number;
  readonly snapshotsClassified: number;
  readonly snapshotsSkipped: number;
  /**
   * Best regime in this algo's average pp lead vs the unconditional
   * baseline, sample-weighted across (remaining, distance) cells where
   * both regime and baseline clear the sample floor. `null` when no
   * regime has any qualifying cell.
   */
  readonly maxLeadPp: number | null;
  /**
   * Shared bp x-axis for the regime chart — every integer bp from 0 to
   * `SURVIVAL_MAX_DISTANCE_BP - 1`. Both the baseline densified
   * arrays and every regime's densified arrays index into this.
   */
  readonly distancesBp: readonly number[];
  /**
   * Densified baseline survival surface (unconditional, the same one
   * the Baseline section renders). Repeated on every algo slice so the
   * regime chart can overlay it without a cross-slice lookup.
   */
  readonly baseline: RegimeSurfaceArrays;
  readonly buckets: readonly RegimeBucketSlice[];
};

type RegimeBucketSlice = {
  readonly regime: string;
  readonly windowShare: number;
  readonly snapshotsTotal: number;
  /**
   * Average pp lead vs baseline for this regime. Sample-weighted by
   * the regime's per-cell sample count, across (remaining, distance)
   * cells where both regime and baseline clear the sample floor.
   * Positive = regime sits above baseline on average; negative = below.
   * `null` when no qualifying cells exist.
   */
  readonly avgLeadPp: number | null;
  /**
   * Densified per-bp win-rate arrays, one per remaining slot. Powers
   * the regime chart — one line per regime overlaid on the baseline.
   */
  readonly surface: RegimeSurfaceArrays;
};

type RegimeSurfaceArrays = Readonly<
  Record<
    SurvivalRemainingMinutes,
    {
      readonly winRate: readonly (number | null)[];
      readonly sampleCount: readonly number[];
    }
  >
>;

/**
 * Chart-ready data for one filter section. Three densified surfaces
 * (baseline / whenTrue / whenFalse) sharing the same `distancesBp`
 * x-axis, plus per-remaining best-improvement metrics that drive the
 * tab badges and the default-selected tab.
 */
type FilterSlice = {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly trueLabel: string;
  readonly falseLabel: string;
  readonly distancesBp: readonly number[];
  readonly baseline: FilterSurfaceArrays;
  readonly whenTrue: FilterSurfaceArrays;
  readonly whenFalse: FilterSurfaceArrays;
  readonly summary: {
    readonly snapshotsTrue: number;
    readonly snapshotsFalse: number;
    readonly snapshotsSkipped: number;
    readonly occurrenceTrue: number;
    readonly occurrenceFalse: number;
    /** Headline filter quality — see `SurvivalFilterSummary.calibrationScore`. */
    readonly calibrationScore: number;
    readonly calibrationScoreByRemaining: Readonly<
      Record<SurvivalRemainingMinutes, number>
    >;
    readonly sweetSpot: {
      readonly startBp: number;
      readonly endBp: number;
      readonly calibrationScore: number;
      readonly coverageFraction: number;
    } | null;
    readonly scoresByRemaining: Readonly<
      Record<
        SurvivalRemainingMinutes,
        { readonly true: ScoreSlice; readonly false: ScoreSlice }
      >
    >;
  };
  /**
   * Pre-picked best remaining-minutes bucket: the one whose
   * `max(|true.score|, |false.score|)` is largest. That's where the
   * filter has its strongest signal in either direction (do-trade or
   * avoid-trade). `4` is used as a fallback when no bucket has any
   * comparable data, so the chart always has something to default to.
   */
  readonly defaultRemaining: SurvivalRemainingMinutes;
};

/**
 * Mirror of `SurvivalScorePayload` reshaped for the renderer. Same
 * fields, copied through `toFilterSlice` so the JSON serialized into
 * the page is the renderer's canonical view of the score (no further
 * normalization on the client).
 */
type ScoreSlice = {
  readonly score: number;
  readonly coverageBp: number;
  readonly meanDeltaPp: number | null;
  readonly maxDeltaPp: number | null;
  readonly minDeltaPp: number | null;
  readonly sharpe: number | null;
  readonly logLossImprovementNats: number | null;
};

type FilterSurfaceArrays = Readonly<
  Record<
    SurvivalRemainingMinutes,
    {
      readonly winRate: readonly (number | null)[];
      readonly sampleCount: readonly number[];
    }
  >
>;

/**
 * Chart-ready survival data. `distancesBp` is the shared x-axis (every
 * integer bp from 0 to `SURVIVAL_MAX_DISTANCE_BP - 1`). For each remaining
 * bucket we carry parallel arrays:
 *
 *   - `winRate[i]` ∈ [0, 100] or `null` when the bucket is empty/sparse
 *     (below `REGIME_CELL_MIN_SAMPLES`). uPlot draws nulls as gaps.
 *   - `sampleCount[i]` is the raw bucket size (always present, even when
 *     below the floor — used in tooltips so the operator can see why a
 *     point was hidden).
 *
 * `windowCount` powers the per-section header.
 */
type SurvivalSlice = {
  readonly windowCount: number;
  readonly distancesBp: readonly number[];
  readonly byRemaining: Readonly<
    Record<
      SurvivalRemainingMinutes,
      {
        readonly winRate: readonly (number | null)[];
        readonly sampleCount: readonly number[];
      }
    >
  >;
};

/**
 * Renders a self-contained dark-themed HTML dashboard for the
 * `training:distributions` analysis. One tab per asset; each tab shows
 * the unconditional point-of-no-return survival surface as the
 * "Baseline" section, then one collapsible section per registered
 * filter overlay below it. Filter sections render their main
 * survival-vs-baseline chart and a delta-from-baseline chart with
 * density-weighted fills.
 *
 * The body/range size distribution and per-year breakdowns are
 * computed and persisted in the JSON sidecar but not rendered here —
 * the dashboard focuses on the trading-relevant survival surface.
 */
export function renderTrainingDistributionsHtml({
  payload,
}: {
  readonly payload: TrainingDistributionsPayload;
}): string {
  const survivalByAsset = new Map<string, AssetSurvivalDistribution>();
  for (const survival of payload.survival) {
    survivalByAsset.set(survival.asset, survival);
  }
  const filtersByAsset = new Map<string, AssetSurvivalFilters>();
  for (const filterBundle of payload.survivalFilters) {
    filtersByAsset.set(filterBundle.asset, filterBundle);
  }
  const regimesByAsset = new Map<string, AssetRegimeAlgos>();
  for (const regimeBundle of payload.regimeAlgos) {
    regimesByAsset.set(regimeBundle.asset, regimeBundle);
  }
  const slices = payload.assets.map((asset) =>
    toDashboardSlice({
      asset,
      survival: survivalByAsset.get(asset.asset) ?? null,
      filters: filtersByAsset.get(asset.asset) ?? null,
      regimes: regimesByAsset.get(asset.asset) ?? null,
    }),
  );
  const seriesLabel = `${payload.series.source}-${payload.series.product} ${payload.series.timeframe}`;
  const generatedAt = formatGeneratedAt(payload.generatedAtMs);
  const survivalLegendItems = SURVIVAL_REMAINING_ORDER.map(
    (rem) =>
      `<span class="alea-legend-item"><span class="alea-legend-swatch" style="background:${SURVIVAL_REMAINING_COLORS[rem]}"></span>${rem}m left</span>`,
  ).join("");

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alea · Hold-rate by distance, time, and regime</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.min.css" />
  <script src="https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.iife.min.js" charset="utf-8"></script>
  ${aleaDesignSystemHead()}
  <style>
    /* Page-specific layout: the asset panel composition, the chart-host
       sizing, and a few percentile-table tweaks (sticky-ish first column,
       per-series row label colors). Tokens, fonts, cards, tabs, generic
       table styling, and tooltip chrome all come from the design system. */
    .asset-panel { display: flex; flex-direction: column; gap: 18px; }

    /* Top-level page nav. Lives between the page header and the main
       content. Each entry maps to a future dashboard page; placeholders
       are rendered dimmed with a "soon" tooltip until they exist as
       real routes. */
    .alea-topnav {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 36px;
      background: rgba(7, 9, 10, 0.6);
      border-bottom: 1px solid var(--alea-border-muted);
      overflow-x: auto;
    }
    .alea-topnav-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: 6px;
      font-family: var(--alea-font-sans);
      font-size: 12.5px;
      letter-spacing: 0.04em;
      color: var(--alea-text-muted);
      text-decoration: none;
      transition: background 80ms ease, color 80ms ease;
      white-space: nowrap;
    }
    .alea-topnav-link:hover {
      color: var(--alea-text);
      background: rgba(215, 170, 69, 0.06);
    }
    .alea-topnav-link.active {
      color: var(--alea-gold);
      background: rgba(215, 170, 69, 0.10);
      box-shadow: inset 0 0 0 1px rgba(215, 170, 69, 0.35);
    }
    .alea-topnav-link.disabled {
      color: var(--alea-text-subtle);
      cursor: not-allowed;
      opacity: 0.55;
    }
    .alea-topnav-link.disabled:hover {
      background: transparent;
      color: var(--alea-text-subtle);
    }
    .alea-topnav-soon {
      font-size: 8px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      padding: 2px 5px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.04);
      color: var(--alea-text-subtle);
    }
    @media (max-width: 720px) {
      .alea-topnav { padding: 6px 12px; }
      .alea-topnav-link { padding: 6px 10px; font-size: 12px; }
    }

    /* Regime sections: per-algo collapsibles with a head-to-head
       per-(regime × remaining) win-rate table. Mirrors the filter-
       section visual chrome so the two read as siblings. */
    .regime-sections-host {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    details.regime-section {
      border-radius: 10px;
      background: rgba(15, 27, 18, 0.4);
      border: 1px solid var(--alea-border-muted);
      overflow: hidden;
    }
    details.regime-section[open] {
      background: rgba(15, 27, 18, 0.6);
    }
    details.regime-section > summary {
      list-style: none;
      cursor: pointer;
      padding: 12px 14px;
      display: grid;
      grid-template-columns: 1fr auto auto;
      column-gap: 14px;
      align-items: center;
    }
    details.regime-section > summary::-webkit-details-marker { display: none; }
    details.regime-section > summary:hover {
      background: rgba(0, 0, 0, 0.18);
    }
    .regime-summary-title {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--alea-text);
      display: inline-flex;
      align-items: baseline;
      gap: 10px;
    }
    .regime-summary-title .algo-title-name { color: var(--alea-text); }
    .regime-summary-title .algo-title-buckets {
      color: var(--alea-text-subtle);
      font-size: 11px;
      font-weight: 400;
      letter-spacing: 0.02em;
      margin-left: -4px;     /* tighten to the algo name */
    }
    /* LIVE badge — same visual language as the cross-asset summary
       and filter-section badges: gold pill with dot. Defined in one
       place so all three locations stay in sync. */
    .regime-summary-live {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-left: 10px;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(215, 170, 69, 0.10);
      border: 1px solid rgba(215, 170, 69, 0.45);
      font-size: 9px;
      font-weight: 500;
      letter-spacing: 0.20em;
      text-transform: uppercase;
      color: var(--alea-gold);
      font-family: var(--alea-font-sans);
      vertical-align: middle;
    }
    .regime-summary-live::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--alea-gold);
      box-shadow: 0 0 4px rgba(215, 170, 69, 0.6);
    }
    .regime-summary-headlines {
      display: flex;
      gap: 14px;
      align-items: baseline;
      color: var(--alea-text-subtle);
      font-size: 12.5px;
      font-variant-numeric: tabular-nums;
    }
    .regime-summary-headlines .key { color: var(--alea-text-muted); margin-right: 4px; }
    /* Chevron is icon-only (▾ collapsed / ▴ open). Both glyphs render
       at identical width so toggling open/closed never shifts the
       neighboring summary metrics horizontally. */
    .regime-summary-chevron {
      color: var(--alea-text-muted);
      font-size: 13px;
      width: 14px;
      text-align: center;
      flex-shrink: 0;
      line-height: 1;
    }
    .regime-section-body {
      padding: 0 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .regime-section-body .regime-helper {
      margin: 0;
      color: var(--alea-text-muted);
      font-size: 12.5px;
      line-height: 1.5;
    }
    .regime-section-body .regime-params {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 11.5px;
      color: var(--alea-text-subtle);
      font-variant-numeric: tabular-nums;
    }
    .regime-section-body .regime-params .param {
      padding: 3px 8px;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--alea-border-faint);
    }
    .regime-section-body .regime-table-wrap {
      overflow-x: auto;
      width: 100%;
    }
    /* Algo-section headline pill — single "max lead" metric showing
       the best regime's average pp lead over baseline. + = green,
       − = red. Matches the .regime-summary-headlines cell layout. */
    .regime-section .regime-summary-lead {
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--alea-border-faint);
      font-variant-numeric: tabular-nums;
    }
    .regime-section .regime-summary-lead .key {
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--alea-text-subtle);
    }
    .regime-section .regime-summary-lead .val {
      font-size: 13px;
      font-weight: 500;
    }
    .regime-section .regime-summary-lead.lead-up .val { color: var(--alea-green); }
    .regime-section .regime-summary-lead.lead-down .val { color: var(--alea-red); }
    .regime-section .regime-summary-lead.lead-flat .val { color: var(--alea-text-muted); }
    /* Per-regime stats beneath the chart: one row per regime, columns
       aligned across rows so the eye can scan vertically. Outer is a
       5-column grid; each .regime-stat is a CSS subgrid spanning the
       full row, so column widths line up across regimes AND we can
       hang a faint row separator on the row element itself. */
    .regime-section-body .regime-stats-row {
      display: grid;
      grid-template-columns:
        max-content           /* swatch */
        max-content           /* regime name */
        max-content           /* share % */
        max-content           /* lead pp */
        max-content;          /* live pill (or empty placeholder) */
      column-gap: 14px;
      justify-content: start;
      padding: 4px 4px 0;
      font-size: 12.5px;
      font-variant-numeric: tabular-nums;
    }
    .regime-section-body .regime-stat {
      display: grid;
      grid-template-columns: subgrid;
      grid-column: 1 / -1;
      align-items: center;
      padding: 6px 0;
    }
    .regime-section-body .regime-stat + .regime-stat {
      border-top: 1px solid var(--alea-border-faint);
    }
    .regime-section-body .regime-stat-name {
      color: var(--alea-text);
      font-weight: 500;
      margin-left: -6px;            /* pull name closer to the swatch */
    }
    .regime-section-body .regime-stat-share {
      color: var(--alea-text-subtle);
      font-size: 11.5px;
      justify-self: end;
      min-width: 36px;
    }
    .regime-section-body .regime-stat-lead {
      font-weight: 500;
      justify-self: end;
      min-width: 56px;
    }
    .regime-section-body .regime-stat-lead.lead-up { color: var(--alea-green); }
    .regime-section-body .regime-stat-lead.lead-down { color: var(--alea-red); }
    .regime-section-body .regime-stat-lead.lead-flat { color: var(--alea-text-muted); }
    .regime-section-body .regime-stat-leading-slot { justify-self: start; min-width: 56px; }
    /* Leading-regime pill: gold dot + "live" label, attached to the
       per-regime stat row when this (algo, regime) makes it into the
       live probability table. */
    .regime-section-body .regime-stat-leading {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(215, 170, 69, 0.10);
      border: 1px solid rgba(215, 170, 69, 0.45);
      color: var(--alea-gold);
      font-size: 9px;
      letter-spacing: 0.20em;
      text-transform: uppercase;
      font-family: var(--alea-font-sans);
    }
    .regime-section-body .regime-stat-leading::before {
      content: "";
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--alea-gold);
      box-shadow: 0 0 4px rgba(215, 170, 69, 0.6);
    }
    .regime-section-body table.regime-table {
      width: 100%;
      min-width: 540px;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 12.5px;
      font-variant-numeric: tabular-nums;
      color: var(--alea-text);
    }
    .regime-section-body table.regime-table th,
    .regime-section-body table.regime-table td {
      padding: 7px 10px;
      text-align: right;
      border-bottom: 1px solid var(--alea-border-faint);
      white-space: nowrap;
    }
    .regime-section-body table.regime-table th:first-child,
    .regime-section-body table.regime-table td:first-child {
      text-align: left;
    }
    .regime-section-body table.regime-table thead th {
      color: var(--alea-text-subtle);
      font-weight: 500;
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      border-bottom: 1px solid var(--alea-border-muted);
    }
    .regime-section-body table.regime-table tbody td.no-data {
      color: var(--alea-text-subtle);
    }
    .regime-section-body table.regime-table tbody td .winrate {
      font-weight: 600;
      font-size: 13px;
    }
    .regime-section-body table.regime-table tbody td .samples {
      color: var(--alea-text-subtle);
      font-size: 11px;
      margin-left: 4px;
    }
    .regime-section-body table.regime-table tbody tr.baseline-row {
      color: var(--alea-text-subtle);
      font-style: italic;
    }
    /* Inline color swatch next to each regime label so the legend
       between the chart and table is implicit — same color in both
       places. */
    .regime-section-body .regime-swatch {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 2px;
      margin-right: 8px;
      vertical-align: middle;
    }
    /* Tab row above each regime chart. Same shape as the legacy
       filter tabs so the patterns line up across sections. */
    .regime-section-body .regime-tabs {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .regime-section-body .regime-tab {
      padding: 6px 12px;
      font-size: 11.5px;
      font-family: var(--alea-font-sans);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: rgba(0, 0, 0, 0.2);
      color: var(--alea-text-subtle);
      border: 1px solid var(--alea-border-faint);
      border-radius: 5px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .regime-section-body .regime-tab:hover {
      color: var(--alea-text);
      border-color: var(--alea-border-muted);
    }
    .regime-section-body .regime-tab.active {
      background: rgba(70, 195, 123, 0.18);
      color: var(--alea-text);
      border-color: rgba(70, 195, 123, 0.55);
    }
    /* Per-chart host inside a regime section. Same height as the
       baseline survival chart so all charts on the page have a
       consistent visual rhythm. */
    .regime-section-body .regime-chart-host {
      width: 100%;
      height: 340px;
      min-height: 340px;
      max-height: 340px;
    }

    .chart-section { display: flex; flex-direction: column; gap: 14px; }

    .chart-frame {
      position: relative;
      border-radius: 10px;
      background:
        radial-gradient(circle at 92% 10%, rgba(215, 170, 69, 0.05), transparent 36%),
        linear-gradient(180deg, rgba(15, 27, 18, 0.6), rgba(7, 9, 10, 0.4));
      border: 1px solid var(--alea-border-muted);
      padding: 12px 8px 6px;
    }

    .chart-host {
      position: relative;
      width: 100%;
      height: 380px;
      min-height: 380px;
      max-height: 380px;
    }

    .chart-loading {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--alea-text-subtle);
      font-size: 12.5px;
      letter-spacing: 0.04em;
    }

    .chart-error {
      color: var(--alea-red);
      font-family: var(--alea-font-mono);
      padding: 12px;
      margin: 0;
      white-space: pre-wrap;
      font-size: 12px;
    }

    /* Push the candle-count meta to the right edge of the card header. */
    .alea-card-meta-end { margin-left: auto; }

    /* Survival section: a chart inside the asset panel. Spacing matches
       the surrounding blocks so the section reads as a sibling rather
       than a new card. */
    .survival-section { display: flex; flex-direction: column; gap: 14px; }

    .survival-helper {
      margin: 0;
      color: var(--alea-text-muted);
      font-size: 12.5px;
      line-height: 1.5;
      max-width: 760px;
    }

    .survival-empty {
      margin: 0;
      padding: 24px;
      color: var(--alea-text-subtle);
      font-size: 13px;
      text-align: center;
      border: 1px dashed var(--alea-border-muted);
      border-radius: 10px;
      background: rgba(15, 22, 16, 0.4);
    }

    /* Filter overlay sections — one per binary filter. Same visual
       language as the survival section but with a remaining-minutes tab
       row above a single full-size chart. */
    .filter-sections-host { display: flex; flex-direction: column; gap: 14px; }

    /* Remaining-minutes tab row above each filter chart. Compact
       segmented-control feel: subtle background, antique-gold underline
       on the active tab to match the asset tabs at the top of the page. */
    .filter-tabs {
      display: inline-flex;
      gap: 0;
      align-self: flex-start;
      border: 1px solid var(--alea-border-muted);
      border-radius: 8px;
      overflow: hidden;
      background: linear-gradient(
        180deg,
        rgba(16, 23, 15, 0.92),
        rgba(8, 10, 8, 0.92)
      );
    }
    .filter-tab {
      padding: 10px 22px;
      border: 0;
      background: transparent;
      color: var(--alea-text-subtle);
      font-family: var(--alea-font-sans);
      font-size: 11.5px;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      cursor: pointer;
      border-right: 1px solid var(--alea-border-muted);
      transition: color 120ms ease, background-color 120ms ease;
      outline: none;
      font-variant-numeric: tabular-nums;
    }
    .filter-tab:last-child { border-right: 0; }
    .filter-tab:hover,
    .filter-tab:focus-visible {
      color: var(--alea-text);
      background: rgba(215, 170, 69, 0.04);
    }
    .filter-tab:focus-visible {
      outline: 1px solid var(--alea-border-strong);
      outline-offset: -3px;
    }
    .filter-tab.active {
      color: var(--alea-gold);
      background: rgba(215, 170, 69, 0.06);
      box-shadow: inset 0 -2px 0 0 var(--alea-gold);
    }
    .filter-tab .filter-tab-delta {
      margin-left: 16px;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: none;
      color: var(--alea-text-subtle);
    }
    .filter-tab .filter-tab-delta-good {
      color: var(--alea-green);
      font-weight: 600;
    }
    .filter-tab .filter-tab-delta-bad {
      color: var(--alea-red);
      font-weight: 600;
      margin-left: 6px;
    }
    .filter-tab.active .filter-tab-delta-good { color: var(--alea-green); }
    .filter-tab.active .filter-tab-delta-bad { color: var(--alea-red); }

    /* Collapsible filter section. Each filter is a <details> element so
       the page can scale to a dozen+ filters without becoming a wall.
       Collapsed state shows the filter title + a row of per-config
       score pills so the operator can scan signal strength across all
       filters at a glance before deciding what to expand. */
    details.filter-section {
      border: 1px solid var(--alea-border-muted);
      border-radius: 12px;
      background: linear-gradient(
        180deg,
        rgba(16, 23, 15, 0.7),
        rgba(8, 10, 8, 0.5)
      );
      overflow: hidden;
      transition: border-color 120ms ease;
    }
    details.filter-section[open] {
      border-color: var(--alea-border);
    }
    /* Two-row grid summary at every viewport: row 1 holds the
       filter title, the calibration-score headline, and the
       expand/collapse chevron; row 2 holds per-rem score pills
       full-width. Row 1 is "what is this filter, how good is it
       overall, how do I open it"; row 2 is "where exactly is
       its edge". */
    details.filter-section > summary {
      list-style: none;
      cursor: pointer;
      padding: 16px 20px;
      display: grid;
      grid-template-columns: 1fr auto auto;
      grid-template-rows: auto auto;
      column-gap: 18px;
      row-gap: 12px;
      align-items: center;
      user-select: none;
      transition: background-color 120ms ease;
    }
    details.filter-section > summary::-webkit-details-marker { display: none; }
    details.filter-section > summary:hover {
      background: rgba(215, 170, 69, 0.04);
    }
    details.filter-section > summary > .filter-summary-title {
      grid-column: 1;
      grid-row: 1;
      font-family: var(--alea-font-display);
      font-weight: 600;
      font-size: 17px;
      letter-spacing: 0.04em;
      color: var(--alea-text);
      margin: 0;
      min-width: 0;
      /* Override the summary's user-select:none so the operator can
         select / copy the filter id from the title. The mousedown
         handler on the summary detects an active text selection and
         suppresses the toggle so single-click on text doesn't expand
         the section while the user is mid-drag. */
      user-select: text;
      cursor: text;
    }
    details.filter-section > summary > .filter-summary-calibration {
      grid-column: 2;
      grid-row: 1;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      font-variant-numeric: tabular-nums;
      min-width: 96px;
    }
    .filter-summary-calibration .calibration-value {
      font-family: var(--alea-font-display);
      font-size: 18px;
      font-weight: 600;
      letter-spacing: 0.02em;
      line-height: 1;
      color: var(--alea-gold);
    }
    .filter-summary-calibration .calibration-value-faint {
      color: var(--alea-text-muted);
    }
    .filter-summary-calibration .calibration-label {
      font-size: 9px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--alea-text-subtle);
    }
    details.filter-section > summary > .filter-summary-chevron {
      grid-column: 3;
      grid-row: 1;
      color: var(--alea-text-subtle);
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      white-space: nowrap;
      /* Fix the column width so the title (1fr) doesn't reflow when
         the chevron text swaps between "expand ▾" and "collapse ▴". */
      display: inline-block;
      min-width: 92px;
      text-align: right;
      transition: color 120ms ease;
    }
    details.filter-section[open] > summary > .filter-summary-chevron {
      color: var(--alea-gold);
    }
    /* Per-rem score pills span the full width on their own row when
       the section is collapsed. They're hidden when the section is
       open because the in-section clickable tabs carry the same
       per-rem calibration information (and the user can actually
       *act* on tabs by clicking them). The calibration badge keeps
       its column position in either state. */
    details.filter-section > summary > .filter-summary-scores {
      grid-column: 1 / -1;
      grid-row: 2;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-start;
    }
    details.filter-section[open] > summary > .filter-summary-scores {
      display: none;
    }
    details.filter-section[open] > summary {
      padding-bottom: 10px;
    }
    /* Score pill: rem label + that rem's contribution to the headline
       calibration score in % terms. Fixed minimum width so pills line
       up across rows of different filters. */
    .filter-summary-score {
      display: inline-flex;
      align-items: baseline;
      gap: 8px;
      padding: 5px 11px;
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--alea-border-faint);
      font-family: var(--alea-font-sans);
      font-variant-numeric: tabular-nums;
      color: var(--alea-text-subtle);
      min-width: 96px;
      box-sizing: border-box;
    }
    .filter-summary-score .score-rem {
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--alea-text-subtle);
      flex-shrink: 0;
    }
    .filter-summary-score .score-value {
      font-size: 13px;
      font-weight: 500;
      color: var(--alea-text);
      margin-left: auto;
    }
    .filter-summary-score .score-value-good {
      color: var(--alea-green);
      font-weight: 600;
    }
    .filter-summary-score .score-value-bad {
      color: var(--alea-red);
      font-weight: 600;
    }
    /* Body of the expanded section — sits inside the details element. */
    .filter-section-body {
      padding: 0 20px 22px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    /* Per-cell metrics — diagnostic breakdown for the currently-
       selected (remaining) tab. Two side-by-side cards, one per half,
       each with the half label as a heading and the metrics laid out
       in an aligned label/value grid below. Cards stack on narrow
       viewports. Updates in place when the user clicks a different
       remaining-minutes tab. */
    .filter-cell-metrics {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      font-family: var(--alea-font-sans);
      font-variant-numeric: tabular-nums;
    }
    .filter-cell-metrics .cell-half {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.22);
      border: 1px solid var(--alea-border-faint);
    }
    .filter-cell-metrics .cell-half-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--alea-border-faint);
    }
    .filter-cell-metrics .cell-half-name {
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--alea-text);
      font-weight: 500;
    }
    .filter-cell-metrics .cell-half-headline {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .filter-cell-metrics .cell-half-headline-good { color: var(--alea-green); }
    .filter-cell-metrics .cell-half-headline-bad { color: var(--alea-red); }
    .filter-cell-metrics .cell-half-headline-faint { color: var(--alea-text-muted); }
    .filter-cell-metrics .cell-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: 14px;
      row-gap: 4px;
      align-items: baseline;
    }
    .filter-cell-metrics .cell-grid-label {
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--alea-text-subtle);
    }
    .filter-cell-metrics .cell-grid-value {
      font-size: 13px;
      font-weight: 500;
      color: var(--alea-text);
      text-align: right;
    }
    .filter-cell-metrics .cell-grid-value-good { color: var(--alea-green); }
    .filter-cell-metrics .cell-grid-value-bad { color: var(--alea-red); }
    .filter-cell-metrics .cell-grid-value-faint { color: var(--alea-text-muted); }
    .filter-cell-metrics .cell-half-empty {
      font-size: 12px;
      color: var(--alea-text-muted);
      font-style: italic;
      padding: 6px 0;
    }
    @media (max-width: 720px) {
      .filter-cell-metrics { grid-template-columns: 1fr; }
    }

    /* Delta-from-baseline chart, stacked under each filter's main chart. */
    .filter-delta-frame {
      position: relative;
      border-radius: 10px;
      background:
        radial-gradient(circle at 92% 10%, rgba(215, 170, 69, 0.05), transparent 36%),
        linear-gradient(180deg, rgba(15, 27, 18, 0.6), rgba(7, 9, 10, 0.4));
      border: 1px solid var(--alea-border-muted);
      padding: 12px 8px 6px;
    }
    .filter-delta-host {
      position: relative;
      width: 100%;
      height: 260px;
      min-height: 260px;
      max-height: 260px;
    }


    /* Mobile / narrow-viewport tweaks. The base layout assumes there's
       enough horizontal room for the filter title, a row of pills, and
       a chevron in the same line, plus a full-width tab strip with
       inline score badges. On phones we use a 2x2 grid for pills, keep
       title + chevron locked on the same row regardless of title length
       (CSS grid avoids the flex-wrap problem long titles caused), and
       fade the right edge of the tab strip so the user can see there's
       more to scroll to. */
    @media (max-width: 720px) {
      /* Asset tabs: drop the 96px min-width so all 5 assets fit one
         row with proportional sizing, instead of wrapping 3+2. */
      .alea-tabs { flex-wrap: nowrap; }
      .alea-tab {
        min-width: 0;
        padding: 11px 6px;
        font-size: 11.5px;
        letter-spacing: 0.12em;
      }

      /* The base summary already uses the 2-row grid; mobile only
         needs to tighten padding + typography. */
      details.filter-section > summary {
        column-gap: 10px;
        row-gap: 10px;
        padding: 14px 16px;
      }
      details.filter-section > summary > .filter-summary-title {
        font-size: 15.5px;
        line-height: 1.25;
      }
      details.filter-section > summary > .filter-summary-chevron {
        align-self: start;
      }
      /* Tighter pill grid on mobile: smaller between-pill gap so
         two pills fit per row, with the inner rem-to-value gap
         already tightened by the base style. */
      details.filter-section > summary > .filter-summary-scores {
        gap: 6px;
      }
      .filter-summary-score {
        flex: 1 1 calc(50% - 3px);
        min-width: 0;
        padding: 5px 10px;
      }

      .filter-section-body { padding: 0 14px 18px; gap: 12px; }

      /* Inline tab strip with a fading-right gradient so users can
         see there's more to scroll to when 4 tabs don't fit in
         viewport width. The mask is applied to the strip itself,
         not the chart frame, so charts stay crisp. */
      .filter-tabs {
        display: flex;
        width: 100%;
        align-self: stretch;
        overflow-x: auto;
        scrollbar-width: none;
        -webkit-mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);
                mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);
      }
      .filter-tabs::-webkit-scrollbar { display: none; }
      .filter-tab {
        flex: 1 1 0;
        padding: 8px 10px;
        font-size: 11px;
        letter-spacing: 0.08em;
        white-space: nowrap;
      }
      .filter-tab .filter-tab-delta {
        margin-left: 8px;
        white-space: nowrap;
      }

      /* Tighter chart heights on mobile — the baseline + delta charts
         each lose ~60px of unnecessary chrome at phone widths. */
      .chart-frame { padding: 10px 8px 4px; }
      .chart-host { height: 280px; min-height: 280px; max-height: 280px; }
      .filter-delta-frame { padding: 10px 8px 4px; }
      .filter-delta-host { height: 200px; min-height: 200px; max-height: 200px; }

      /* Tighter typography on the page header + survival helper. */
      .alea-subtitle { font-size: 11.5px; }
      .survival-helper { font-size: 12px; line-height: 1.45; }
    }

    /* ------------------------------------------------------------------
       Active-config strip: a single line below the page subtitle that
       surfaces the named constants currently driving the analysis. Read-
       only; updates on regen. The point is "here's the policy this
       dashboard reflects" — so the operator never has to grep the source
       to know which thresholds are in play. */
    .alea-config-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 18px;
      align-items: baseline;
      margin-top: 6px;
      padding: 8px 14px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.22);
      border: 1px solid var(--alea-border-faint);
      font-family: var(--alea-font-sans);
      font-size: 11px;
      color: var(--alea-text-subtle);
      letter-spacing: 0.06em;
      font-variant-numeric: tabular-nums;
    }
    .alea-config-strip .config-item { display: inline-flex; align-items: baseline; gap: 6px; }
    .alea-config-strip .config-key {
      font-size: 9px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--alea-text-subtle);
    }
    .alea-config-strip .config-val {
      color: var(--alea-text);
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.04em;
    }

    /* ------------------------------------------------------------------
       Cross-asset summary: a compact table at the page top showing the
       headline calibration % and sweet-spot range for every (filter,
       asset) cell, so the operator can scan all 10 cells without tab-
       switching between assets. Lives ABOVE the asset tabs. */
    .cross-asset-summary {
      margin-top: 14px;
      padding: 12px 14px 10px;
      border-radius: 10px;
      background:
        radial-gradient(circle at 92% 10%, rgba(215, 170, 69, 0.04), transparent 36%),
        linear-gradient(180deg, rgba(15, 27, 18, 0.55), rgba(7, 9, 10, 0.4));
      border: 1px solid var(--alea-border-muted);
    }
    .cross-asset-summary .ca-title-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--alea-border-faint);
      margin-bottom: 10px;
      flex-wrap: nowrap;
    }
    .cross-asset-summary .ca-title {
      font-family: var(--alea-font-display);
      font-size: 13px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--alea-gold);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .cross-asset-summary .ca-hint {
      font-size: 12px;
      letter-spacing: 0.02em;
      text-transform: none;
      color: var(--alea-text-subtle);
      max-width: 760px;
      text-align: right;
      line-height: 1.45;
      flex-shrink: 1;
    }
    .cross-asset-summary table {
      width: 100%;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
    }
    .cross-asset-summary th,
    .cross-asset-summary td {
      padding: 8px 10px;
      text-align: right;
      vertical-align: middle;
      font-size: 12px;
    }
    .cross-asset-summary thead th {
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--alea-text-subtle);
      border-bottom: 1px solid var(--alea-border-faint);
    }
    .cross-asset-summary thead th:first-child,
    .cross-asset-summary tbody th {
      text-align: left;
    }
    .cross-asset-summary tbody th {
      font-weight: 500;
      color: var(--alea-text);
      letter-spacing: 0.04em;
      font-family: var(--alea-font-sans);
    }
    .cross-asset-summary tbody tr.live-row {
      background: rgba(215, 170, 69, 0.05);
    }
    .cross-asset-summary tbody tr.live-row td:last-child,
    .cross-asset-summary tbody tr.live-row th { /* visual nudge for live row */ }
    .cross-asset-summary .ca-cell-pop {
      color: var(--alea-text);
      font-weight: 500;
      font-size: 13px;
    }
    .cross-asset-summary .ca-cell-pop.ca-cell-up { color: var(--alea-green); }
    .cross-asset-summary .ca-cell-pop.ca-cell-down { color: var(--alea-red); }
    .cross-asset-summary .ca-cell-pop.ca-cell-flat { color: var(--alea-text-muted); }
    .cross-asset-summary .ca-cell-sweet {
      color: var(--alea-text);
      font-size: 11px;
      letter-spacing: 0.04em;
      display: block;
      margin-top: 2px;
    }
    .cross-asset-summary .ca-filter-cell {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .cross-asset-summary .ca-row-algo {
      color: var(--alea-text);
      font-weight: 500;
      font-size: 12.5px;
    }
    .cross-asset-summary .ca-row-buckets {
      color: var(--alea-text-subtle);
      font-size: 10.5px;
      font-weight: 400;
      letter-spacing: 0.02em;
      margin-left: 6px;
    }
    .cross-asset-summary .ca-row-regime {
      color: var(--alea-text-subtle);
      font-size: 11.5px;
      letter-spacing: 0.02em;
    }
    .cross-asset-summary .ca-live-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 9px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--alea-gold);
      margin-top: 2px;
    }
    .cross-asset-summary .ca-live-tag::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--alea-gold);
      box-shadow: 0 0 4px rgba(215, 170, 69, 0.5);
    }

    /* ------------------------------------------------------------------
       LIVE badge: small pill rendered next to the filter title for the
       filter currently powering live trading. */
    .filter-summary-live {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-left: 10px;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(215, 170, 69, 0.10);
      border: 1px solid rgba(215, 170, 69, 0.45);
      font-size: 9px;
      letter-spacing: 0.20em;
      text-transform: uppercase;
      color: var(--alea-gold);
      font-family: var(--alea-font-sans);
      vertical-align: middle;
    }
    .filter-summary-live::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--alea-gold);
      box-shadow: 0 0 4px rgba(215, 170, 69, 0.6);
    }

    /* ------------------------------------------------------------------
       Dual headline pair: replaces the single calibration badge with a
       side-by-side "pop / sweet [bp range]" so the operator sees both
       the no-filter context number and the actionable restricted-range
       number at the same level of visual prominence. */
    details.filter-section > summary > .filter-summary-headlines {
      grid-column: 2;
      grid-row: 1;
    }
    .filter-summary-headlines {
      display: flex;
      align-items: stretch;
      gap: 10px;
      font-variant-numeric: tabular-nums;
    }
    .filter-summary-headline {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      min-width: 76px;
    }
    .filter-summary-headline .headline-value {
      font-family: var(--alea-font-display);
      font-size: 18px;
      font-weight: 600;
      line-height: 1;
      letter-spacing: 0.02em;
    }
    .filter-summary-headline.pop .headline-value { color: var(--alea-text); }
    .filter-summary-headline.sweet .headline-value { color: var(--alea-gold); }
    .filter-summary-headline.faint .headline-value { color: var(--alea-text-muted); }
    .filter-summary-headline .headline-label {
      font-size: 9px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--alea-text-subtle);
    }
    .filter-summary-headline .headline-sub {
      font-size: 10px;
      color: var(--alea-text-muted);
      letter-spacing: 0.04em;
    }
    .filter-summary-headlines .headline-divider {
      width: 1px;
      background: var(--alea-border-faint);
    }

    /* ------------------------------------------------------------------
       Sub-720px tweaks already exist above. These extra-tight rules kick
       in at phone widths where the multi-chart filter section starts to
       waste vertical real estate. */
    /* On mobile (and below) the filter section header uses 3 rows
       instead of 2 so the title gets its own full-width line and the
       headlines (pop / sweet) don't steal column space and force the
       title to wrap word-by-word. Pills land on row 3 as before. */
    @media (max-width: 720px) {
      details.filter-section > summary {
        grid-template-columns: 1fr auto;
        grid-template-rows: auto auto auto;
      }
      details.filter-section > summary > .filter-summary-title {
        grid-column: 1;
        grid-row: 1;
      }
      details.filter-section > summary > .filter-summary-chevron {
        grid-column: 2;
        grid-row: 1;
      }
      details.filter-section > summary > .filter-summary-headlines {
        grid-column: 1 / -1;
        grid-row: 2;
        justify-content: flex-start;
      }
      details.filter-section > summary > .filter-summary-headlines > .filter-summary-headline {
        align-items: flex-start;
      }
      details.filter-section > summary > .filter-summary-scores {
        grid-row: 3;
      }
    }

    @media (max-width: 480px) {
      .alea-title { font-size: 22px; line-height: 1.15; }
      .alea-config-strip { gap: 4px 12px; padding: 6px 10px; font-size: 10px; }
      .alea-config-strip .config-val { font-size: 11px; }

      /* Cross-asset summary on small phones: the table itself stays
         a normal grid but its container scrolls horizontally so all 5
         asset columns can fit at readable size. We hide the
         scrollbar chrome and add a subtle fade on the right edge as
         a swipe affordance. */
      .cross-asset-summary {
        padding: 10px 0 8px;
        margin-top: 10px;
      }
      .cross-asset-summary .ca-title-row {
        flex-direction: column;
        gap: 2px;
        align-items: flex-start;
        padding: 0 12px 6px;
        margin-bottom: 6px;
      }
      .cross-asset-summary .ca-title { font-size: 11px; letter-spacing: 0.14em; }
      .cross-asset-summary .ca-hint { font-size: 9px; letter-spacing: 0.10em; }
      .cross-asset-summary .ca-table-wrap {
        overflow-x: auto;
        scrollbar-width: none;
        -webkit-mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);
                mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);
        padding: 0 12px;
      }
      .cross-asset-summary .ca-table-wrap::-webkit-scrollbar { display: none; }
      .cross-asset-summary table { min-width: 460px; }
      .cross-asset-summary th, .cross-asset-summary td { padding: 6px 6px; font-size: 11px; white-space: nowrap; }
      .cross-asset-summary tbody th { font-size: 11px; min-width: 110px; }
      .cross-asset-summary .ca-cell-pop { font-size: 12px; }
      .cross-asset-summary .ca-cell-sweet { font-size: 10px; }
      .cross-asset-summary .ca-live-tag { font-size: 8px; letter-spacing: 0.12em; }

      details.filter-section > summary { padding: 12px 12px; column-gap: 8px; }
      details.filter-section > summary > .filter-summary-title { font-size: 14px; }
      .filter-summary-headlines { gap: 8px; }
      .filter-summary-headline { min-width: 0; }
      .filter-summary-headline .headline-value { font-size: 15px; }
      .filter-summary-live {
        margin-left: 6px;
        padding: 2px 6px;
        font-size: 8px;
        letter-spacing: 0.14em;
      }
      .filter-summary-live::before { width: 5px; height: 5px; }

      .filter-section-body { padding: 0 12px 14px; gap: 10px; }
      /* Charts get tighter on phones — reduce visual chrome and a touch
         of vertical real estate, but keep tap targets and text legible. */
      .chart-host { height: 240px; min-height: 240px; max-height: 240px; }
      .filter-delta-host { height: 170px; min-height: 170px; max-height: 170px; }
      .filter-cell-metrics { gap: 8px; }
      .filter-cell-metrics .cell-half { padding: 8px 10px; }
      .filter-cell-metrics .cell-grid { column-gap: 10px; }
      .filter-cell-metrics .cell-grid-value { font-size: 12px; }
    }
  </style>
</head>
<body>
  <div class="alea-shell">
    <header class="alea-header">
      <div class="alea-brand-row">${aleaBrandMark()}</div>
      <h1 class="alea-title">Hold-rate by distance, time, and regime</h1>
      <p class="alea-subtitle">${escapeHtml(seriesLabel)}<span class="sep">·</span>generated ${escapeHtml(generatedAt)}</p>
      <div class="alea-config-strip" title="Constants in src/constants/trading.ts and computeSweetSpot.ts that drive scoring + sweet-spot detection. Changing any of these is a code change with reviewable diff.">
        <span class="config-item"><span class="config-key">min distance</span><span class="config-val">${MIN_ACTIONABLE_DISTANCE_BP} bp</span></span>
        <span class="config-item"><span class="config-key">sample floor</span><span class="config-val">${REGIME_CELL_MIN_SAMPLES.toLocaleString()}</span></span>
      </div>
    </header>
    ${renderTopNav({ activeId: "training" })}
    <main class="alea-main">
      ${renderCrossAssetSummary({ slices })}
      <nav class="alea-tabs" role="tablist" id="tabs">
        ${slices
          .map(
            (slice, idx) =>
              `<button type="button" role="tab" class="alea-tab${idx === 0 ? " active" : ""}" data-asset="${escapeHtml(slice.asset)}">${escapeHtml(slice.assetUpper)}</button>`,
          )
          .join("\n        ")}
      </nav>
      <section class="alea-card with-corners asset-panel" id="asset-panel">
        <header class="alea-card-header">
          <h2 class="alea-card-title" id="asset-title"></h2>
          <p class="alea-card-meta" id="asset-meta"></p>
          <p class="alea-card-meta alea-card-meta-end" id="asset-count"></p>
        </header>

        <div class="alea-section-rule">
          <h2>Baseline</h2>
        </div>
        <p class="survival-helper">How often the leading side stayed ahead until window close.<br>By distance from the 5m start price and minutes remaining.<br>Regime sections below split this same data by market context.<br>Buckets under ${REGIME_CELL_MIN_SAMPLES.toLocaleString()} snapshots hidden.</p>

        <div class="survival-section" id="survival-section">
          <p class="alea-card-meta" id="survival-meta"></p>
          <div class="alea-legend">
            ${survivalLegendItems}
          </div>
          <div class="chart-frame">
            <div id="survival-chart" class="chart-host"><div class="chart-loading">Loading chart…</div></div>
            <div id="survival-tooltip" class="alea-tooltip"></div>
          </div>
        </div>

        <div class="alea-section-rule">
          <h2>Regime Algos</h2>
        </div>
        <p class="survival-helper">Each algo splits the data by market context — does it separate outcomes from the baseline?<br>Each section's chart overlays the regime curves on the baseline so you can see which lead and which lag.</p>

        <div class="regime-sections-host" id="regime-sections-host"></div>
      </section>
    </main>
  </div>
  <script>
    const slices = ${JSON.stringify(slices)};
    const chartTokens = ${JSON.stringify(aleaChartTokens)};
    const survivalRemainingOrder = ${JSON.stringify(SURVIVAL_REMAINING_ORDER)};
    const survivalRemainingColors = ${JSON.stringify(SURVIVAL_REMAINING_COLORS)};
    const regimeCellMinSamples = ${REGIME_CELL_MIN_SAMPLES};
    const minActionableDistanceBp = ${MIN_ACTIONABLE_DISTANCE_BP};
    const survivalXAxisPadBp = ${SURVIVAL_X_AXIS_PAD_BP};
    const liveTradingAlgoIds = ${JSON.stringify([...LIVE_TRADING_ALGO_IDS])};
    const leadingRegimeMinLeadPp = ${LEADING_REGIME_MIN_LEAD_PP};

    // Auto-fit the y-axis to actual data range, clamped to [0, 100] for
    // the % charts. The hard-coded [0, 100] was wasting most of the
    // chart's vertical real estate because survival rates rarely touch
    // either extreme — cropping to (min - pad, max + pad) makes the
    // mid-section actually readable. Pads are floored so charts with a
    // tight range still get some breathing room.
    function autoFitPercentYRange({ yArrays, includeReferenceFifty }) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const ys of yArrays) {
        for (const v of ys) {
          if (v == null || !Number.isFinite(v)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 100];
      // Keep the 50% reference visible when it's near (or just outside)
      // the data range, so the chart can show the coin-flip line for
      // intuition; skip when the data is way above 50% to stop wasting
      // height showing the line in isolation.
      if (includeReferenceFifty && lo > 50 && lo - 50 < 10) lo = 50;
      const span = Math.max(5, hi - lo);
      const pad = Math.max(2, span * 0.08);
      return [Math.max(0, lo - pad), Math.min(100, hi + pad)];
    }

    // Largest distance bucket index where any of the given y arrays still
    // has a (finite) value. Returns the matching bp + a small pad so the
    // rightmost line stays a few bp away from the axis. Falls back to
    // the original axis cap if no point qualifies — keeps the chart
    // sane on empty data.
    function autoFitMaxBp({ xs, yArrays }) {
      let maxIdx = -1;
      for (const ys of yArrays) {
        for (let i = ys.length - 1; i > maxIdx; i--) {
          const v = ys[i];
          if (v != null && Number.isFinite(v)) {
            maxIdx = i;
            break;
          }
        }
      }
      if (maxIdx < 0) {
        return xs[xs.length - 1] != null ? xs[xs.length - 1] : 1;
      }
      const lastBp = xs[maxIdx] != null ? xs[maxIdx] : maxIdx;
      const padded = lastBp + survivalXAxisPadBp;
      const cap = xs[xs.length - 1] != null ? xs[xs.length - 1] + 1 : padded;
      return Math.min(padded, cap);
    }

    const tabsEl = document.getElementById("tabs");
    const titleEl = document.getElementById("asset-title");
    const metaEl = document.getElementById("asset-meta");
    const countEl = document.getElementById("asset-count");

    const survivalSectionEl = document.getElementById("survival-section");
    const survivalMetaEl = document.getElementById("survival-meta");
    const survivalChartHost = document.getElementById("survival-chart");
    const survivalTooltipEl = document.getElementById("survival-tooltip");
    const survivalChartFrame = survivalChartHost.parentElement;
    let survivalChart = null;

    // ----------------------------------------------------------------
    // Survival section: a second chart + table inside the same panel.
    // The chart shows current-side hold rate as a function of distance
    // from the 5m line, one series per remaining-minutes bucket. The
    // table inverts the question: how much distance does each remaining
    // bucket need to historically reach a given hold-rate target?
    // ----------------------------------------------------------------

    const formatBp = (v) => {
      if (v == null || !Number.isFinite(v)) return "—";
      return Math.round(v).toLocaleString() + " bp";
    };

    function survivalChartHostError(msg) {
      survivalChartHost.innerHTML = '<pre class="chart-error">' + msg + '</pre>';
    }

    function renderSurvivalEmpty(message) {
      if (survivalChart) { survivalChart.destroy(); survivalChart = null; }
      survivalChartHost.innerHTML = '<div class="chart-loading">' + message + '</div>';
      if (survivalMetaEl) survivalMetaEl.textContent = "";
    }

    function renderSurvivalChart(survival) {
      if (survivalChart) { survivalChart.destroy(); survivalChart = null; }
      survivalChartHost.innerHTML = "";
      if (typeof uPlot === "undefined") {
        survivalChartHostError("uPlot global is undefined — CDN failed to load?");
        return;
      }
      const w = survivalChartHost.clientWidth || survivalChartHost.getBoundingClientRect().width || 800;
      const h = survivalChartHost.clientHeight || 380;
      if (w === 0 || h === 0) {
        survivalChartHostError("chart host has zero size: " + w + "x" + h);
        return;
      }
      // Shared x-axis is every integer bp across the display range; each
      // remaining-minutes series is a parallel y array (null for sparse
      // buckets, which uPlot draws as gaps).
      const xs = survival.distancesBp.slice();
      const yArrays = survivalRemainingOrder.map(
        (rem) => survival.byRemaining[rem].winRate.slice(),
      );
      const sampleArrays = survivalRemainingOrder.map(
        (rem) => survival.byRemaining[rem].sampleCount.slice(),
      );
      // Auto-fit the x-axis to where data actually ends. The fixed-cap
      // version left a ton of empty space on the right when even the
      // longest line died out at ~30 bp.
      const xMax = autoFitMaxBp({ xs: xs, yArrays: yArrays });
      const data = [xs].concat(yArrays);
      const series = [{}].concat(
        survivalRemainingOrder.map((rem) => ({
          label: rem + "m left",
          stroke: survivalRemainingColors[rem],
          width: 2,
          spanGaps: false,
          points: { show: false },
        })),
      );
      const updateTooltip = (u) => {
        const idx = u.cursor.idx;
        if (idx == null || idx < 0 || idx >= xs.length) {
          survivalTooltipEl.classList.remove("visible");
          return;
        }
        const x = xs[idx];
        let rows = '';
        for (let i = 0; i < survivalRemainingOrder.length; i++) {
          const rem = survivalRemainingOrder[i];
          const wr = yArrays[i][idx];
          const n = sampleArrays[i][idx];
          const value = wr == null
            ? '<span class="value" style="color: var(--alea-text-subtle)">n=' + n.toLocaleString() + '</span>'
            : '<span class="value">' + wr.toFixed(1) + '% <span style="color: var(--alea-text-subtle); font-weight: 400; margin-left: 6px">n=' + n.toLocaleString() + '</span></span>';
          rows +=
            '<div class="alea-tooltip-row"><span class="alea-legend-swatch" style="background:' + survivalRemainingColors[rem] + '"></span><span class="name">' + rem + 'm left</span>' + value + '</div>';
        }
        survivalTooltipEl.innerHTML =
          '<div class="alea-tooltip-head">' + formatBp(x) + ' from line</div>' + rows;
        const cursorLeft = u.cursor.left;
        const frameW = survivalChartFrame.getBoundingClientRect().width;
        const tooltipW = survivalTooltipEl.offsetWidth || 240;
        const margin = 14;
        const placeRight = cursorLeft + margin + tooltipW <= frameW;
        const left = placeRight ? cursorLeft + margin : cursorLeft - margin - tooltipW;
        survivalTooltipEl.style.left = Math.max(margin, Math.min(left, frameW - tooltipW - margin)) + "px";
        survivalTooltipEl.style.top = "14px";
        survivalTooltipEl.classList.add("visible");
      };
      const opts = {
        width: w,
        height: h,
        legend: { show: false },
        padding: [16, 18, 8, 8],
        scales: (() => {
          const yRange = autoFitPercentYRange({
            yArrays: yArrays,
            includeReferenceFifty: true,
          });
          return {
            x: { time: false, range: [0, xMax] },
            y: { range: yRange },
          };
        })(),
        cursor: {
          points: { show: false },
          drag: { setScale: false, x: false, y: false },
        },
        series: series,
        axes: [
          {
            stroke: chartTokens.axisStroke,
            font: chartTokens.axisFont,
            labelFont: chartTokens.axisFont,
            label: "distance from price line (bp)",
            labelSize: 28,
            grid: { stroke: chartTokens.gridStroke, width: 1 },
            ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
            values: (u, splits) => splits.map((v) => Math.round(v).toLocaleString()),
          },
          {
            stroke: chartTokens.axisStroke,
            font: chartTokens.axisFont,
            labelFont: chartTokens.axisFont,
            label: "hold rate %",
            labelSize: 28,
            grid: { stroke: chartTokens.gridStroke, width: 1 },
            ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
            values: (u, splits) => splits.map((v) => Math.round(v) + "%"),
            size: 60,
          },
        ],
        hooks: {
          setCursor: [updateTooltip],
          // Faint horizontal reference at 50% (coin-flip baseline). Drawn
          // behind the curves via drawAxes, same pattern as the body/wick
          // chart's p50 line.
          drawAxes: [
            (u) => {
              const yPos = u.valToPos(50, "y", true);
              const ctx = u.ctx;
              ctx.save();
              ctx.strokeStyle = chartTokens.referenceLine;
              ctx.lineWidth = 1;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(u.bbox.left, yPos);
              ctx.lineTo(u.bbox.left + u.bbox.width, yPos);
              ctx.stroke();
              ctx.restore();
            },
          ],
        },
      };
      try {
        survivalChart = new uPlot(opts, data, survivalChartHost);
        survivalChartHost.addEventListener("mouseleave", () => survivalTooltipEl.classList.remove("visible"));
      } catch (err) {
        survivalChartHostError("uPlot threw: " + (err && err.message ? err.message : String(err)));
      }
    }

    function renderSurvival(slice) {
      const survival = slice.survival;
      if (!survival) {
        renderSurvivalEmpty("No 1m candle data yet for " + slice.assetUpper + ".");
        return;
      }
      if (survivalMetaEl) {
        survivalMetaEl.textContent = "";
      }
      renderSurvivalChart(survival);
    }

    // ----------------------------------------------------------------
    // Filter sections: one per binary filter. Each section renders a
    // single full-size chart at one remaining-minutes bucket, with a
    // tab row above it for switching buckets. The default tab is the
    // bucket where the filter most strongly tightens the point of no
    // return. Tab badges show the per-bucket best improvement so the
    // operator sees at a glance where the filter helps before clicking.
    // ----------------------------------------------------------------

    const filterColors = ${JSON.stringify(FILTER_COLORS)};
    const filterSectionsHost = document.getElementById("filter-sections-host");
    // Track every filter-chart uPlot instance so the ResizeObserver and
    // window resize handler can poke them all when the viewport changes.
    // Each entry also carries the filter slice + currently-selected
    // remaining-minutes bucket so the tab click handler can replace the
    // chart in place.
    const filterCharts = [];

    function clearFilterSections() {
      for (const entry of filterCharts) {
        try { entry.chart.destroy(); } catch (e) { /* ignore */ }
      }
      filterCharts.length = 0;
      if (filterSectionsHost) filterSectionsHost.innerHTML = "";
    }

    function formatPercent(v) {
      if (v == null || !Number.isFinite(v)) return "—";
      const pct = v * 100;
      return pct < 10 ? pct.toFixed(1) + "%" : Math.round(pct) + "%";
    }

    // Calibration score formatter. The raw value is "average nats
    // saved per population-snapshot vs no-filter baseline." For the
    // headline display we render it as a percentage of baseline
    // log-loss (~ln 2 ≈ 0.693 nats for a binary outcome): a 0.005
    // raw score → 0.7%. That gives the operator an immediately
    // interpretable scale ("how much better than nothing"). The raw
    // value is in the tooltip for sorting precision.
    var BASELINE_LOG_LOSS_NATS = 0.6931471805599453;

    // Headline pair: side-by-side "pop X% / sweet Y% [a-b bp]" so the
    // operator sees the two key calibration numbers at the same level
    // of visual prominence. The sweet-spot column carries the bp range
    // as its sublabel since that's what live trading would gate on; the
    // pop column carries the "vs no-filter" caption since pop is the
    // population-wide average.
    function formatHeadlinePair(summary) {
      const popScore = summary.calibrationScore;
      const popPct = (popScore === null || popScore === undefined ||
        !Number.isFinite(popScore))
        ? null
        : (popScore / BASELINE_LOG_LOSS_NATS) * 100;
      const popClass = (popPct === null || popPct < 0.05)
        ? 'filter-summary-headline pop faint'
        : 'filter-summary-headline pop';
      const popValueText = popPct === null ? '—' : popPct.toFixed(2) + '%';
      const popTooltip = popPct === null
        ? 'No comparable buckets.'
        : 'Population calibration: ' + popScore.toFixed(6) +
          ' nats/snapshot vs no-filter (' + popPct.toFixed(2) + '% of baseline log-loss). Whole-data average.';

      const ss = summary.sweetSpot;
      let sweetCellHtml;
      if (ss === null || ss === undefined) {
        sweetCellHtml =
          '<div class="filter-summary-headline sweet faint" title="No positive info gain — filter has no actionable bp range.">' +
            '<span class="headline-value">—</span>' +
            '<span class="headline-label">no sweet spot</span>' +
          '</div>';
      } else {
        const sweetPct = (ss.calibrationScore / BASELINE_LOG_LOSS_NATS) * 100;
        const sweetTooltip = (
          'Sweet-spot calibration: ' + sweetPct.toFixed(2) +
          '% on snapshots in [' + ss.startBp + '–' + ss.endBp + '] bp ' +
          '(coverage = ' + (ss.coverageFraction * 100).toFixed(1) + '%). ' +
          'This is the range the live trader acts on for this filter.'
        );
        sweetCellHtml =
          '<div class="filter-summary-headline sweet" title="' + sweetTooltip + '">' +
            '<span class="headline-value">' + sweetPct.toFixed(2) + '%</span>' +
            '<span class="headline-label">sweet [' + ss.startBp + '–' + ss.endBp + ' bp]</span>' +
          '</div>';
      }

      return (
        '<div class="filter-summary-headlines">' +
          '<div class="' + popClass + '" title="' + popTooltip + '">' +
            '<span class="headline-value">' + popValueText + '</span>' +
            '<span class="headline-label">pop</span>' +
          '</div>' +
          '<div class="headline-divider"></div>' +
          sweetCellHtml +
        '</div>'
      );
    }

    // Per-(remaining, half) detail metrics. Two side-by-side cards,
    // one per half. Each card has the half label as a heading with a
    // signed-score headline (since the two halves are sign-opposed by
    // construction at any given remaining), and an aligned label/value
    // grid below for the diagnostic metrics.
    function formatCellGridRow(label, value, klass) {
      const valClass = 'cell-grid-value' + (klass ? ' ' + klass : '');
      const valHtml = (value === null || value === undefined)
        ? '<span class="cell-grid-value cell-grid-value-faint">—</span>'
        : '<span class="' + valClass + '">' + value + '</span>';
      return (
        '<span class="cell-grid-label">' + label + '</span>' +
        valHtml
      );
    }
    function formatCellHalfCard(score, halfLabel) {
      if (!score || score.coverageBp === 0) {
        return (
          '<div class="cell-half">' +
            '<div class="cell-half-header">' +
              '<span class="cell-half-name">' + halfLabel + '</span>' +
              '<span class="cell-half-headline cell-half-headline-faint">—</span>' +
            '</div>' +
            '<div class="cell-half-empty">no comparable buckets</div>' +
          '</div>'
        );
      }
      const headlineClass = score.score >= 0
        ? 'cell-half-headline-good'
        : 'cell-half-headline-bad';
      const headlineSign = score.score >= 0 ? '+' : '−';
      const headlineText = headlineSign + Math.abs(score.score).toFixed(1);
      const meanFmt = score.meanDeltaPp === null
        ? null
        : (score.meanDeltaPp >= 0 ? '+' : '−') +
          Math.abs(score.meanDeltaPp).toFixed(2) + ' pp';
      const meanKlass = score.meanDeltaPp === null
        ? null
        : (score.meanDeltaPp >= 0 ? 'cell-grid-value-good' : 'cell-grid-value-bad');
      const sharpeFmt = score.sharpe === null ? null : score.sharpe.toFixed(2);
      const sharpeKlass = score.sharpe === null
        ? null
        : (score.sharpe >= 0 ? 'cell-grid-value-good' : 'cell-grid-value-bad');
      const logLossFmt = score.logLossImprovementNats === null
        ? null
        : score.logLossImprovementNats.toFixed(5);
      return (
        '<div class="cell-half">' +
          '<div class="cell-half-header">' +
            '<span class="cell-half-name">' + halfLabel + '</span>' +
            '<span class="cell-half-headline ' + headlineClass + '">' + headlineText + '</span>' +
          '</div>' +
          '<div class="cell-grid">' +
            formatCellGridRow('mean Δ', meanFmt, meanKlass) +
            formatCellGridRow('sharpe', sharpeFmt, sharpeKlass) +
            formatCellGridRow('logLoss', logLossFmt) +
            formatCellGridRow('coverage', score.coverageBp + ' bp') +
          '</div>' +
        '</div>'
      );
    }
    function formatCellMetrics(args) {
      const filter = args.filter;
      const remaining = args.remaining;
      const cell = filter.summary.scoresByRemaining[remaining];
      if (!cell) return '';
      return (
        formatCellHalfCard(cell.true, filter.trueLabel) +
        formatCellHalfCard(cell.false, filter.falseLabel)
      );
    }

    // Tab badges show this rem's calibration contribution in % terms.
    // Same metric and same sign-based color as the per-rem header
    // pills, so the operator can scan one consistent number across
    // both surfaces.
    function formatTabBadge(filterSummary, rem) {
      const remScore = filterSummary.calibrationScoreByRemaining[rem];
      if (remScore === null || remScore === undefined || !Number.isFinite(remScore)) {
        return "";
      }
      const pct = (remScore / BASELINE_LOG_LOSS_NATS) * 100;
      const klass = pct === 0
        ? ''
        : (pct > 0 ? 'filter-tab-delta-good' : 'filter-tab-delta-bad');
      return ' <span class="filter-tab-delta ' + klass + '">' + pct.toFixed(2) + '%</span>';
    }

    function buildFilterChart({ host, filter, remaining }) {
      if (typeof uPlot === "undefined") {
        host.innerHTML = '<pre class="chart-error">uPlot global is undefined — CDN failed to load?</pre>';
        return null;
      }
      const w = host.clientWidth || host.getBoundingClientRect().width || 800;
      const h = host.clientHeight || 380;
      if (w === 0 || h === 0) {
        host.innerHTML = '<pre class="chart-error">chart host has zero size: ' + w + 'x' + h + '</pre>';
        return null;
      }
      const xs = filter.distancesBp.slice();
      const baselineY = filter.baseline[remaining].winRate.slice();
      const trueY = filter.whenTrue[remaining].winRate.slice();
      const falseY = filter.whenFalse[remaining].winRate.slice();
      const xMax = autoFitMaxBp({ xs: xs, yArrays: [baselineY, trueY, falseY] });
      const data = [xs, baselineY, trueY, falseY];
      const opts = {
        width: w,
        height: h,
        legend: { show: false },
        padding: [16, 18, 8, 8],
        scales: {
          x: { time: false, range: [0, xMax] },
          y: {
            range: autoFitPercentYRange({
              yArrays: [baselineY, trueY, falseY],
              includeReferenceFifty: true,
            }),
          },
        },
        cursor: { points: { show: false }, drag: { setScale: false, x: false, y: false } },
        series: [
          {},
          { label: "baseline", stroke: filterColors.baseline, width: 1.5, spanGaps: false, points: { show: false } },
          { label: filter.trueLabel, stroke: filterColors.whenTrue, width: 2.25, spanGaps: false, points: { show: false } },
          { label: filter.falseLabel, stroke: filterColors.whenFalse, width: 2.25, spanGaps: false, points: { show: false } },
        ],
        axes: [
          {
            stroke: chartTokens.axisStroke,
            font: chartTokens.axisFont,
            labelFont: chartTokens.axisFont,
            label: "distance from price line (bp)",
            labelSize: 28,
            grid: { stroke: chartTokens.gridStroke, width: 1 },
            ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
            values: (u, splits) => splits.map((v) => Math.round(v).toLocaleString()),
          },
          {
            stroke: chartTokens.axisStroke,
            font: chartTokens.axisFont,
            labelFont: chartTokens.axisFont,
            label: "hold rate %",
            labelSize: 28,
            grid: { stroke: chartTokens.gridStroke, width: 1 },
            ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
            values: (u, splits) => splits.map((v) => Math.round(v) + '%'),
            size: 60,
          },
        ],
        hooks: {
          drawAxes: [
            (u) => {
              const yPos = u.valToPos(50, "y", true);
              const ctx = u.ctx;
              ctx.save();
              ctx.strokeStyle = chartTokens.referenceLine;
              ctx.lineWidth = 1;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(u.bbox.left, yPos);
              ctx.lineTo(u.bbox.left + u.bbox.width, yPos);
              ctx.stroke();
              ctx.restore();
            },
          ],
        },
      };
      try {
        return new uPlot(opts, data, host);
      } catch (err) {
        host.innerHTML = '<pre class="chart-error">uPlot threw: ' + (err && err.message ? err.message : String(err)) + '</pre>';
        return null;
      }
    }

    // ----------------------------------------------------------------
    // Delta chart: same x-axis as the main chart but the y-axis is
    // (filter_winRate − baseline_winRate) in pp. Two lines (true/false)
    // — no baseline line drawn (baseline = the y=0 axis). Per-slice
    // density fills under each line, green where the slice is above
    // baseline and red where below; opacity scales with the bucket's
    // sample count so sparse slices look faint and trustworthy ones
    // look bold.
    // ----------------------------------------------------------------

    const deltaColors = ${JSON.stringify(DELTA_COLORS)};

    // Build the per-line "(filter delta in pp, sample count)" arrays for
    // a given remaining-minutes bucket. A delta value is null when
    // either side (filter half or baseline) lacks a usable bucket at
    // that bp.
    function buildDeltaLine({ filter, half, remaining }) {
      const baselineEntry = filter.baseline[remaining];
      const halfEntry = filter[half === "true" ? "whenTrue" : "whenFalse"][remaining];
      const xs = filter.distancesBp;
      const deltas = [];
      const counts = [];
      for (let i = 0; i < xs.length; i++) {
        const baseV = baselineEntry.winRate[i];
        const halfV = halfEntry.winRate[i];
        if (baseV == null || halfV == null) {
          deltas.push(null);
        } else {
          deltas.push(halfV - baseV);
        }
        counts.push(halfEntry.sampleCount[i] || 0);
      }
      return { deltas: deltas, counts: counts };
    }

    function buildDeltaChart({ host, filter, remaining }) {
      if (typeof uPlot === "undefined") {
        host.innerHTML = '<pre class="chart-error">uPlot global is undefined</pre>';
        return null;
      }
      const w = host.clientWidth || host.getBoundingClientRect().width || 800;
      const h = host.clientHeight || 260;
      if (w === 0 || h === 0) {
        host.innerHTML = '<pre class="chart-error">chart host has zero size: ' + w + 'x' + h + '</pre>';
        return null;
      }
      const xs = filter.distancesBp.slice();
      const trueLine = buildDeltaLine({ filter: filter, half: "true", remaining: remaining });
      const falseLine = buildDeltaLine({ filter: filter, half: "false", remaining: remaining });
      const xMax = autoFitMaxBp({ xs: xs, yArrays: [trueLine.deltas, falseLine.deltas] });

      // Y-axis bounds: symmetric around 0 with a small pad. We don't
      // want it to drift to wildly asymmetric ranges that visually
      // distort which side is bigger.
      let extreme = 0;
      for (const a of [trueLine.deltas, falseLine.deltas]) {
        for (const v of a) {
          if (v != null && Number.isFinite(v) && Math.abs(v) > extreme) {
            extreme = Math.abs(v);
          }
        }
      }
      const yPad = Math.max(2, extreme * 0.15);
      const yMax = extreme === 0 ? 5 : extreme + yPad;

      // Densest slice across both halves; per-slice opacity is
      // count / maxCount, with a small floor so non-empty slices remain
      // visible.
      let maxCount = 0;
      for (const a of [trueLine.counts, falseLine.counts]) {
        for (const v of a) {
          if (v > maxCount) maxCount = v;
        }
      }
      const fillOpacityFor = (count) => {
        if (maxCount === 0 || count === 0) return 0;
        const ratio = count / maxCount;
        // Floor + cap tuned upward from the original (0.06–0.55) since
        // the dark green panel background was washing out faint slices.
        // Floor at 0.18 so even a barely-above-floor slice has visible
        // tint; cap at 0.85 so dense slices read as solid color without
        // completely hiding the line on top.
        return Math.max(0.18, Math.min(0.85, ratio * 0.85));
      };

      // Draw a per-bin trapezoid from the line down to y=0, colored by
      // the average sign of the bin's two endpoints, with opacity from
      // the bin's average sample count. Done in a uPlot draw hook so
      // we can do per-slice opacity (uPlot's built-in fill is uniform).
      const drawDensityFill = (u, deltas, counts) => {
        const ctx = u.ctx;
        const yZeroPx = u.valToPos(0, "y", true);
        for (let i = 0; i < xs.length - 1; i++) {
          const v0 = deltas[i];
          const v1 = deltas[i + 1];
          if (v0 == null || v1 == null) continue;
          const c0 = counts[i] || 0;
          const c1 = counts[i + 1] || 0;
          const avgCount = (c0 + c1) / 2;
          const opacity = fillOpacityFor(avgCount);
          if (opacity <= 0) continue;
          const x0Px = u.valToPos(xs[i], "x", true);
          const x1Px = u.valToPos(xs[i + 1], "x", true);
          const y0Px = u.valToPos(v0, "y", true);
          const y1Px = u.valToPos(v1, "y", true);
          // Color decision: average sign of v0 and v1. If both above 0,
          // green. Both below, red. Crossing zero, split into two
          // sub-trapezoids at the zero crossing.
          const drawTrap = (xa, ya, xb, yb, color) => {
            ctx.fillStyle = 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',' + opacity + ')';
            ctx.beginPath();
            ctx.moveTo(xa, yZeroPx);
            ctx.lineTo(xa, ya);
            ctx.lineTo(xb, yb);
            ctx.lineTo(xb, yZeroPx);
            ctx.closePath();
            ctx.fill();
          };
          const sameSign = (v0 >= 0 && v1 >= 0) || (v0 <= 0 && v1 <= 0);
          if (sameSign) {
            const color = (v0 + v1) / 2 >= 0 ? deltaColors.fillAbove : deltaColors.fillBelow;
            drawTrap(x0Px, y0Px, x1Px, y1Px, color);
          } else {
            // Find the zero crossing's x position via linear interp.
            const t = v0 / (v0 - v1);
            const xCrossVal = xs[i] + t * (xs[i + 1] - xs[i]);
            const xCrossPx = u.valToPos(xCrossVal, "x", true);
            const firstColor = v0 >= 0 ? deltaColors.fillAbove : deltaColors.fillBelow;
            const secondColor = v1 >= 0 ? deltaColors.fillAbove : deltaColors.fillBelow;
            drawTrap(x0Px, y0Px, xCrossPx, yZeroPx, firstColor);
            drawTrap(xCrossPx, yZeroPx, x1Px, y1Px, secondColor);
          }
        }
      };

      const data = [xs, trueLine.deltas.slice(), falseLine.deltas.slice()];
      const opts = {
        width: w,
        height: h,
        legend: { show: false },
        padding: [12, 18, 8, 8],
        scales: { x: { time: false, range: [0, xMax] }, y: { range: [-yMax, yMax] } },
        cursor: { points: { show: false }, drag: { setScale: false, x: false, y: false } },
        series: [
          {},
          { label: filter.trueLabel, stroke: deltaColors.trueLine, width: 2, spanGaps: false, points: { show: false } },
          { label: filter.falseLabel, stroke: deltaColors.falseLine, width: 2, spanGaps: false, points: { show: false } },
        ],
        axes: [
          {
            stroke: chartTokens.axisStroke,
            font: chartTokens.axisFont,
            labelFont: chartTokens.axisFont,
            label: "distance from price line (bp)",
            labelSize: 28,
            grid: { stroke: chartTokens.gridStroke, width: 1 },
            ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
            values: (u, splits) => splits.map((v) => Math.round(v).toLocaleString()),
          },
          {
            stroke: chartTokens.axisStroke,
            font: chartTokens.axisFont,
            labelFont: chartTokens.axisFont,
            label: "vs baseline (Δ%)",
            labelSize: 28,
            grid: { stroke: chartTokens.gridStroke, width: 1 },
            ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
            values: (u, splits) => splits.map((v) => (v > 0 ? "+" : "") + Math.round(v)),
            size: 60,
          },
        ],
        hooks: {
          // Density fills first (under the lines), then the zero rule,
          // then uPlot draws the line strokes on top.
          drawClear: [
            (u) => {
              drawDensityFill(u, trueLine.deltas, trueLine.counts);
              drawDensityFill(u, falseLine.deltas, falseLine.counts);
            },
          ],
          drawAxes: [
            (u) => {
              const yPos = u.valToPos(0, "y", true);
              const ctx = u.ctx;
              ctx.save();
              ctx.strokeStyle = deltaColors.zeroRule;
              ctx.lineWidth = 1;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(u.bbox.left, yPos);
              ctx.lineTo(u.bbox.left + u.bbox.width, yPos);
              ctx.stroke();
              ctx.restore();
            },
          ],
        },
      };
      try {
        return new uPlot(opts, data, host);
      } catch (err) {
        host.innerHTML = '<pre class="chart-error">uPlot threw: ' + (err && err.message ? err.message : String(err)) + '</pre>';
        return null;
      }
    }

    function renderFilterSection(filter, expanded) {
      const summary = filter.summary;
      const legendHtml =
        '<span class="alea-legend-item"><span class="alea-legend-swatch" style="background:' + filterColors.baseline + '"></span>baseline</span>' +
        '<span class="alea-legend-item"><span class="alea-legend-swatch" style="background:' + filterColors.whenTrue + '"></span>' + filter.trueLabel + '</span>' +
        '<span class="alea-legend-item"><span class="alea-legend-swatch" style="background:' + filterColors.whenFalse + '"></span>' + filter.falseLabel + '</span>';

      // Tabs render in fixed 4m → 1m order so the operator can compare
      // the same column across filters at a glance. The strongest
      // signal still gets the default-selected highlight (via
      // filter.defaultRemaining), but the order itself stays put.
      const tabsHtml = survivalRemainingOrder.map((rem) => {
        const isActive = rem === filter.defaultRemaining;
        const badge = formatTabBadge(summary, rem);
        return (
          '<button type="button" class="filter-tab' + (isActive ? ' active' : '') +
          '" data-filter-id="' + filter.id + '" data-remaining="' + rem + '">' +
          rem + 'm left' + badge + '</button>'
        );
      }).join("");
      // Per-rem pills shown in the section header — each rem's
      // contribution to the headline calibration score in % terms.
      // Same 4m → 1m order as the tabs and chart legend. Visible in
      // both collapsed and expanded states so the header layout
      // doesn't shift when toggled.
      const summaryScoresHtml = survivalRemainingOrder.map((rem) => {
        const remScore = filter.summary.calibrationScoreByRemaining[rem];
        const remPct = (typeof remScore === 'number' && Number.isFinite(remScore))
          ? (remScore / BASELINE_LOG_LOSS_NATS) * 100
          : null;
        // Sign-based color: green for positive, red for negative.
        // calibrationScoreByRemaining is non-negative by construction
        // (per-bucket halfRate is the MLE on its own snapshots, so it
        // can't underperform the global rate in expectation), but we
        // honour the sign rule generically in case a future metric
        // change exposes signed values here.
        const valueClass = remPct === null || remPct === 0
          ? ''
          : (remPct > 0 ? ' score-value-good' : ' score-value-bad');
        const valueText = remPct === null ? '—' : remPct.toFixed(2) + '%';
        const tooltip = remPct === null
          ? 'No comparable buckets at this remaining.'
          : (rem + 'm contributes ' + remPct.toFixed(3) +
             '% of the headline calibration score.');
        return (
          '<span class="filter-summary-score" title="' + tooltip + '">' +
            '<span class="score-rem">' + rem + 'm</span>' +
            '<span class="score-value' + valueClass + '">' + valueText + '</span>' +
          '</span>'
        );
      }).join("");

      // <details> defaults to collapsed; the top-ranked filter for
      // the asset is rendered with the open attribute so its chart is
      // visible without a click. Charts are NOT built here — they're
      // lazy-built on first expand by the toggle listener so we don't
      // render uPlot into a 0-size host.
      const openAttr = expanded ? ' open' : '';
      const chevronText = expanded ? 'collapse ▴' : 'expand ▾';
      const headlinesHtml = formatHeadlinePair(summary);
      const liveBadgeHtml = liveTradingAlgoIds.indexOf(filter.id) >= 0
        ? '<span class="filter-summary-live" title="This is the filter the live trader currently uses (see computeAssetProbabilities.ts)">LIVE</span>'
        : '';
      const cellMetricsHtml = formatCellMetrics({
        filter: filter,
        remaining: filter.defaultRemaining,
      });
      const sectionHtml =
        '<details class="filter-section" data-filter-id="' + filter.id + '"' + openAttr + '>' +
          '<summary>' +
            '<h2 class="filter-summary-title">' + filter.displayName + liveBadgeHtml + '</h2>' +
            headlinesHtml +
            '<div class="filter-summary-scores">' + summaryScoresHtml + '</div>' +
            '<span class="filter-summary-chevron">' + chevronText + '</span>' +
          '</summary>' +
          '<div class="filter-section-body">' +
            '<p class="survival-helper">' + filter.description + '</p>' +
            '<div class="filter-tabs" role="tablist">' + tabsHtml + '</div>' +
            '<div class="filter-cell-metrics" data-filter-id="' + filter.id + '">' + cellMetricsHtml + '</div>' +
            '<div class="alea-legend">' + legendHtml + '</div>' +
            '<div class="chart-frame">' +
              '<div class="chart-host filter-chart-host" data-filter-id="' + filter.id + '"></div>' +
            '</div>' +
            '<div class="filter-delta-frame">' +
              '<div class="filter-delta-host" data-filter-id="' + filter.id + '"></div>' +
            '</div>' +
          '</div>' +
        '</details>';
      if (!filterSectionsHost) return;
      filterSectionsHost.insertAdjacentHTML('beforeend', sectionHtml);
      const detailsEl = filterSectionsHost.querySelector('details.filter-section[data-filter-id="' + filter.id + '"]');
      if (!detailsEl) return;
      // Lazy chart construction: only when first opened. Subsequent
      // tab clicks update the existing charts; subsequent open/close
      // doesn't rebuild anything. We also trigger this immediately
      // for sections rendered with the open attribute (the auto-
      // expanded top filter), since the open attribute on details
      // does not fire a toggle event on initial mount.
      const buildIfNeeded = () => {
        if (!detailsEl.open || detailsEl.dataset.built === '1') return;
        detailsEl.dataset.built = '1';
        const chevron = detailsEl.querySelector('.filter-summary-chevron');
        if (chevron) chevron.textContent = 'collapse ▴';
        const host = detailsEl.querySelector('.filter-chart-host');
        const deltaHost = detailsEl.querySelector('.filter-delta-host');
        if (!host || !deltaHost) return;
        const chart = buildFilterChart({ host: host, filter: filter, remaining: filter.defaultRemaining });
        const deltaChart = buildDeltaChart({ host: deltaHost, filter: filter, remaining: filter.defaultRemaining });
        if (chart) {
          filterCharts.push({
            chart: chart,
            deltaChart: deltaChart,
            host: host,
            deltaHost: deltaHost,
            filter: filter,
            remaining: filter.defaultRemaining,
          });
        }
      };
      detailsEl.addEventListener('toggle', buildIfNeeded);
      if (expanded) {
        buildIfNeeded();
      }
      // Update chevron text when the user collapses again.
      detailsEl.addEventListener('toggle', () => {
        const chevron = detailsEl.querySelector('.filter-summary-chevron');
        if (chevron) chevron.textContent = detailsEl.open ? 'collapse ▴' : 'expand ▾';
      });
      // Allow text selection on the title without toggling the section.
      // We listen on the summary's click and suppress the default
      // toggle whenever the user is mid-drag on the title, so a click-
      // and-drag inside the title selects text instead of opening or
      // closing the section. A bare click anywhere else on the summary
      // (including the title without a drag) still toggles.
      const summaryEl = detailsEl.querySelector('summary');
      const titleEl = detailsEl.querySelector('.filter-summary-title');
      if (summaryEl && titleEl) {
        let titleMousedownAt = null;
        titleEl.addEventListener('mousedown', (e) => {
          titleMousedownAt = { x: e.clientX, y: e.clientY };
        });
        summaryEl.addEventListener('click', (e) => {
          // If the user has an active selection inside the title at
          // click time, suppress the toggle. Otherwise allow it.
          const sel = window.getSelection();
          const titleHasSelection =
            sel && sel.toString().length > 0 &&
            titleEl.contains(sel.anchorNode);
          const startedOnTitle =
            titleMousedownAt !== null &&
            (e.target instanceof Node) &&
            titleEl.contains(e.target);
          const draggedAfterMousedown =
            titleMousedownAt !== null &&
            (Math.abs(e.clientX - titleMousedownAt.x) > 2 ||
              Math.abs(e.clientY - titleMousedownAt.y) > 2);
          if (titleHasSelection || (startedOnTitle && draggedAfterMousedown)) {
            e.preventDefault();
          }
          titleMousedownAt = null;
        });
      }
    }

    function setFilterRemaining({ filterId, remaining }) {
      const entryIdx = filterCharts.findIndex((e) => e.filter.id === filterId);
      if (entryIdx < 0) return;
      const entry = filterCharts[entryIdx];
      try { entry.chart.destroy(); } catch (e) { /* ignore */ }
      try { if (entry.deltaChart) entry.deltaChart.destroy(); } catch (e) { /* ignore */ }
      const newChart = buildFilterChart({ host: entry.host, filter: entry.filter, remaining: remaining });
      const newDeltaChart = buildDeltaChart({ host: entry.deltaHost, filter: entry.filter, remaining: remaining });
      if (newChart) {
        filterCharts[entryIdx] = {
          chart: newChart,
          deltaChart: newDeltaChart,
          host: entry.host,
          deltaHost: entry.deltaHost,
          filter: entry.filter,
          remaining: remaining,
        };
      }
      // Sync tab active state.
      const tabs = filterSectionsHost.querySelectorAll('.filter-tab[data-filter-id="' + filterId + '"]');
      tabs.forEach((tab) => {
        const tabRem = Number(tab.getAttribute('data-remaining'));
        tab.classList.toggle('active', tabRem === remaining);
      });
      // Sync per-cell metrics row for the new selection.
      const metricsHost = filterSectionsHost.querySelector(
        '.filter-cell-metrics[data-filter-id="' + filterId + '"]',
      );
      if (metricsHost) {
        metricsHost.innerHTML = formatCellMetrics({
          filter: entry.filter,
          remaining: remaining,
        });
      }
    }

    function renderFilters(slice) {
      clearFilterSections();
      if (!filterSectionsHost) return;
      if (!slice.filters || slice.filters.length === 0) {
        filterSectionsHost.innerHTML = '<div class="survival-empty">No filter overlays available — needs 1m candle data.</div>';
        return;
      }
      // Sort by calibration score: average nats saved per population-
      // snapshot vs the global (no-filter) baseline. Higher = more
      // useful in production. Auto-expand the top filter so the user
      // sees its chart on first paint.
      const ranked = slice.filters.slice().sort((a, b) =>
        b.summary.calibrationScore - a.summary.calibrationScore,
      );
      ranked.forEach((filter, idx) => {
        renderFilterSection(filter, idx === 0);
      });
    }

    // ----------------------------------------------------------------
    // Regime sections: one per algo per asset. Server-rendered as
    // static HTML on tab switch — the per-(regime, remaining) win-rate
    // table doesn't change interactively (no chart, no tab row), so
    // there's nothing for the client to lazy-build.
    // ----------------------------------------------------------------

    const regimeSectionsHost = document.getElementById("regime-sections-host");

    // Categorical palette for regime lines. 8 colors covers any algo we
    // currently ship (max 6 regimes). Picked for distinguishability on
    // the dark theme — one each from blue/amber/green/red families plus
    // violet/teal/orange/grey for the more granular algos.
    const REGIME_COLORS = [
      "#5b95ff", "#46c37b", "#d7aa45", "#d75a4f",
      "#a16eef", "#5fc8d8", "#f08a3c", "#9eaeb8",
    ];
    const REGIME_BASELINE_COLOR = "#cdd2c8";

    // Per-(asset, algo, remaining) chart instance tracking so the
    // ResizeObserver and tab clicks can update the right chart.
    const regimeCharts = [];

    function clearRegimeSections() {
      for (const entry of regimeCharts) {
        try { entry.chart.destroy(); } catch (e) { /* ignore */ }
      }
      regimeCharts.length = 0;
      if (regimeSectionsHost) regimeSectionsHost.innerHTML = "";
    }

    function escapeHtmlClient(s) {
      if (s == null) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // Plain-English label for one regime id. Falls through to the raw
    // id (snake_case prettified) for any regime not in the explicit
    // map. Keep the map terse — operator scans the chart legend, not
    // the explanation.
    const REGIME_LABEL_MAP = {
      low_vol: "Low vol",
      mid_vol: "Mid vol",
      high_vol: "High vol",
      vol_q1_lowest: "Q1 (lowest vol)",
      vol_q2: "Q2",
      vol_q3: "Q3",
      vol_q4_highest: "Q4 (highest vol)",
      no_trend: "No trend",
      with_trend: "With trend",
      against_trend: "Against trend",
      weak_trend: "Weak trend",
      strong_trend: "Strong trend",
      no_trend_low_vol: "No trend · low vol",
      no_trend_high_vol: "No trend · high vol",
      with_trend_low_vol: "With trend · low vol",
      with_trend_high_vol: "With trend · high vol",
      against_trend_low_vol: "Against trend · low vol",
      against_trend_high_vol: "Against trend · high vol",
      oversold: "Oversold (RSI ≤ 30)",
      neutral: "Neutral RSI",
      overbought: "Overbought (RSI ≥ 70)",
      with_carry: "With carry (matches prev bar)",
      against_carry: "Against carry (fights prev bar)",
    };
    function prettyRegime(id) {
      if (id == null) return '';
      const explicit = REGIME_LABEL_MAP[id];
      if (explicit) return explicit;
      return id.replace(/_/g, ' ');
    }

    // Map a win-rate % into a CSS background color. Centered at 50% =
    // baseline-neutral; greener as we go higher, redder as we go lower.
    // The amplitude is clamped so a 100% cell is bold green and a 0%
    // cell is bold red, with a gentle linear ramp in between.
    function winRateCellStyle(winRate) {
      if (winRate == null || !Number.isFinite(winRate)) return '';
      const t = Math.max(-1, Math.min(1, (winRate - 65) / 25));
      // Below 65 → red; above 65 → green. 65% picked because the
      // baseline curves on these assets cluster around 65–75% in the
      // sweet-spot range, so this anchors the center on what the
      // operator would consider "average."
      const alpha = Math.min(0.42, Math.abs(t) * 0.42);
      const r = t > 0 ? "70, 195, 123" : "216, 90, 79";
      return 'background: rgba(' + r + ', ' + alpha.toFixed(3) + ');';
    }

    function renderRegimeSection(algo, expanded) {
      const algoIsLiveSection = liveTradingAlgoIds.indexOf(algo.id) >= 0;
      // Count regimes whose avgLeadPp clears the leading floor — i.e.
      // the ones that make it into the live probability table for
      // this algo. The LIVE pill shows the count so the operator
      // sees at a glance how many of an algo's buckets are
      // contributing to live trading.
      const leadingCount = !algoIsLiveSection ? 0 : algo.buckets.reduce((acc, b) => {
        const v = (b.avgLeadPp == null || !Number.isFinite(b.avgLeadPp)) ? null : b.avgLeadPp;
        return v !== null && v >= leadingRegimeMinLeadPp ? acc + 1 : acc;
      }, 0);
      // Only show the LIVE pill if at least one regime from this algo
      // actually feeds the live probability table. An algo whose
      // inputs are available but whose regimes don't clear the
      // leading-pp floor is technically eligible but contributes
      // nothing — showing "0 LIVE" was confusing.
      const liveBadge = algoIsLiveSection && leadingCount > 0
        ? '<span class="regime-summary-live" title="' + leadingCount + ' regime' + (leadingCount === 1 ? '' : 's') + ' from this algo are in the live probability table.">' + leadingCount + ' LIVE</span>'
        : '';
      const bucketCount = algo.buckets.length;
      const titleHtml =
        '<span class="algo-title-name">' + escapeHtmlClient(algo.displayName) + '</span>' +
        '<span class="algo-title-buckets">[' + bucketCount + ' bucket' + (bucketCount === 1 ? '' : 's') + ']</span>';
      // Headline = max regime lead vs baseline. Single decision-aligned
      // number: how much the best regime in this algo outpaces the
      // unconditional model on average across (remaining, distance)
      // cells. + = leads, - = lags.
      const maxLead = (algo.maxLeadPp == null || !Number.isFinite(algo.maxLeadPp))
        ? null
        : algo.maxLeadPp;
      const maxLeadStr = maxLead === null
        ? '—'
        : (maxLead >= 0 ? '+' : '') + maxLead.toFixed(1) + 'pp';
      const maxLeadClass = maxLead === null
        ? 'lead-flat'
        : (maxLead > 0 ? 'lead-up' : 'lead-down');
      const headlinesHtml =
        '<span class="regime-summary-lead ' + maxLeadClass + '" title="Best regime in this algo, average pp lead over baseline across (remaining, distance) cells. + = the regime sits above baseline more often than not.">' +
          '<span class="key">max lead</span>' +
          '<span class="val">' + maxLeadStr + '</span>' +
        '</span>';
      const paramsHtml = Object.entries(algo.params || {})
        .map(([k, v]) => '<span class="param">' + escapeHtmlClient(k) + '=' + v + '</span>')
        .join('');

      // Per-regime stat row under the chart: regime name + share + avg
      // lead vs baseline. The chart shows the curves visually; this row
      // quantifies what the eye sees.
      const algoIsLive = liveTradingAlgoIds.indexOf(algo.id) >= 0;
      const regimeStatsHtml = algo.buckets.map((b, idx) => {
        const color = REGIME_COLORS[idx % REGIME_COLORS.length];
        const lead = (b.avgLeadPp == null || !Number.isFinite(b.avgLeadPp)) ? null : b.avgLeadPp;
        const leadStr = lead === null
          ? '—'
          : (lead >= 0 ? '+' : '') + lead.toFixed(1) + 'pp';
        const leadCls = lead === null ? 'lead-flat' : (lead > 0 ? 'lead-up' : 'lead-down');
        const sharePct = (b.windowShare * 100).toFixed(0) + '%';
        // Leading-regime pill: shown when (a) the algo is in
        // LIVE_TRADING_REGIME_ALGOS AND (b) this regime's avgLeadPp
        // clears LEADING_REGIME_MIN_LEAD_PP. Means the live trader's
        // probability table includes a surface for this (algo,
        // regime) pair and decisions can fire on it.
        const isLeading = algoIsLive && lead !== null && lead >= leadingRegimeMinLeadPp;
        // Always render the live-pill column so the grid stays
        // aligned even when this regime isn't leading. Empty span =
        // empty cell.
        const leadingPill = isLeading
          ? '<span class="regime-stat-leading-slot"><span class="regime-stat-leading" title="In production: probability table includes a surface for this regime — live decisions can fire on it.">live</span></span>'
          : '<span class="regime-stat-leading-slot"></span>';
        return (
          '<div class="regime-stat">' +
            '<span class="regime-swatch" style="background:' + color + '"></span>' +
            '<span class="regime-stat-name">' + escapeHtmlClient(prettyRegime(b.regime)) + '</span>' +
            '<span class="regime-stat-share">' + sharePct + '</span>' +
            '<span class="regime-stat-lead ' + leadCls + '">' + leadStr + '</span>' +
            leadingPill +
          '</div>'
        );
      }).join('');

      // Tab row for switching the chart's remaining-minutes bucket.
      // Default to 4m so every algo opens to the same column for
      // consistent cross-algo scanning.
      const defaultRemaining = 4;
      const tabsHtml = survivalRemainingOrder.map((rem) =>
        '<button type="button" class="regime-tab' +
          (rem === defaultRemaining ? ' active' : '') +
          '" data-algo-id="' + escapeHtmlClient(algo.id) +
          '" data-remaining="' + rem + '">' + rem + 'm left</button>'
      ).join('');

      const openAttr = expanded ? ' open' : '';
      const chevronGlyph = expanded ? '▴' : '▾';
      const sectionHtml =
        '<details class="regime-section" data-algo-id="' + escapeHtmlClient(algo.id) + '"' + openAttr + '>' +
          '<summary>' +
            '<h2 class="regime-summary-title">' + titleHtml + liveBadge + '</h2>' +
            '<div class="regime-summary-headlines">' + headlinesHtml + '</div>' +
            '<span class="regime-summary-chevron">' + chevronGlyph + '</span>' +
          '</summary>' +
          '<div class="regime-section-body">' +
            '<p class="regime-helper">' + escapeHtmlClient(algo.description) + '</p>' +
            (paramsHtml ? '<div class="regime-params">' + paramsHtml + '</div>' : '') +
            '<div class="regime-tabs" role="tablist">' + tabsHtml + '</div>' +
            '<div class="chart-frame">' +
              '<div class="chart-host regime-chart-host" data-algo-id="' + escapeHtmlClient(algo.id) + '"></div>' +
            '</div>' +
            '<div class="regime-stats-row" title="Each regime: share of all training windows and average pp lead/lag vs the unconditional baseline.">' + regimeStatsHtml + '</div>' +
          '</div>' +
        '</details>';
      if (!regimeSectionsHost) return;
      regimeSectionsHost.insertAdjacentHTML('beforeend', sectionHtml);
      const detailsEl = regimeSectionsHost.querySelector('details.regime-section[data-algo-id="' + algo.id + '"]');
      if (!detailsEl) return;
      const chartHost = detailsEl.querySelector('.regime-chart-host');
      const buildIfNeeded = () => {
        if (!detailsEl.open || detailsEl.dataset.built === '1') return;
        detailsEl.dataset.built = '1';
        const chevron = detailsEl.querySelector('.regime-summary-chevron');
        if (chevron) chevron.textContent = '▴';
        if (!chartHost) return;
        const chart = buildRegimeChart({ host: chartHost, algo: algo, remaining: defaultRemaining });
        if (chart) {
          regimeCharts.push({ chart: chart, host: chartHost, algo: algo, remaining: defaultRemaining });
        }
      };
      detailsEl.addEventListener('toggle', () => {
        const chevron = detailsEl.querySelector('.regime-summary-chevron');
        if (chevron) chevron.textContent = detailsEl.open ? '▴' : '▾';
        buildIfNeeded();
      });
      if (expanded) buildIfNeeded();
    }

    function buildRegimeChart({ host, algo, remaining }) {
      if (typeof uPlot === "undefined") {
        host.innerHTML = '<pre class="chart-error">uPlot global is undefined</pre>';
        return null;
      }
      const w = host.clientWidth || host.getBoundingClientRect().width || 800;
      const h = host.clientHeight || 380;
      if (w === 0 || h === 0) {
        host.innerHTML = '<pre class="chart-error">chart host has zero size: ' + w + 'x' + h + '</pre>';
        return null;
      }
      const xs = algo.distancesBp.slice();
      const baselineY = algo.baseline[remaining].winRate.slice();
      const regimeYArrays = algo.buckets.map((b) => b.surface[remaining].winRate.slice());
      const allY = [baselineY].concat(regimeYArrays);
      const xMax = autoFitMaxBp({ xs: xs, yArrays: allY });
      const data = [xs, baselineY].concat(regimeYArrays);
      const series = [
        {},
        { label: "baseline", stroke: REGIME_BASELINE_COLOR, width: 1.25, dash: [4, 3], spanGaps: false, points: { show: false } },
      ];
      for (let i = 0; i < algo.buckets.length; i++) {
        const color = REGIME_COLORS[i % REGIME_COLORS.length];
        series.push({
          label: prettyRegime(algo.buckets[i].regime),
          stroke: color,
          width: 2,
          spanGaps: false,
          points: { show: false },
        });
      }
      const opts = {
        width: w,
        height: h,
        legend: { show: false },
        padding: [16, 18, 8, 8],
        scales: {
          x: { time: false, range: [0, xMax] },
          y: {
            range: autoFitPercentYRange({
              yArrays: allY,
              includeReferenceFifty: true,
            }),
          },
        },
        cursor: { points: { show: false }, drag: { setScale: false, x: false, y: false } },
        series: series,
        axes: [
          {
            stroke: chartTokens.axisStroke,
            font: chartTokens.axisFont,
            labelFont: chartTokens.axisFont,
            label: "distance from price line (bp)",
            labelSize: 28,
            grid: { stroke: chartTokens.gridStroke, width: 1 },
            ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
            values: (u, splits) => splits.map((v) => Math.round(v).toLocaleString()),
          },
          {
            stroke: chartTokens.axisStroke,
            font: chartTokens.axisFont,
            labelFont: chartTokens.axisFont,
            label: "hold rate %",
            labelSize: 28,
            grid: { stroke: chartTokens.gridStroke, width: 1 },
            ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
            values: (u, splits) => splits.map((v) => Math.round(v) + '%'),
            size: 60,
          },
        ],
        hooks: {
          drawAxes: [
            (u) => {
              // 50% coin-flip reference line (subtle, dashed).
              const yPos50 = u.valToPos(50, "y", true);
              const ctx = u.ctx;
              ctx.save();
              ctx.strokeStyle = chartTokens.referenceLine;
              ctx.lineWidth = 1;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(u.bbox.left, yPos50);
              ctx.lineTo(u.bbox.left + u.bbox.width, yPos50);
              ctx.stroke();
              ctx.restore();
            },
          ],
        },
      };
      try {
        return new uPlot(opts, data, host);
      } catch (err) {
        host.innerHTML = '<pre class="chart-error">uPlot threw: ' + (err && err.message ? err.message : String(err)) + '</pre>';
        return null;
      }
    }

    function setRegimeRemaining({ algoId, remaining }) {
      const idx = regimeCharts.findIndex((e) => e.algo.id === algoId);
      if (idx < 0) return;
      const entry = regimeCharts[idx];
      try { entry.chart.destroy(); } catch (e) { /* ignore */ }
      const newChart = buildRegimeChart({ host: entry.host, algo: entry.algo, remaining: remaining });
      if (newChart) {
        regimeCharts[idx] = { chart: newChart, host: entry.host, algo: entry.algo, remaining: remaining };
      }
      const tabs = regimeSectionsHost.querySelectorAll('.regime-tab[data-algo-id="' + algoId + '"]');
      tabs.forEach((tab) => {
        const tabRem = Number(tab.getAttribute('data-remaining'));
        tab.classList.toggle('active', tabRem === remaining);
      });
    }

    if (regimeSectionsHost) {
      regimeSectionsHost.addEventListener('click', (e) => {
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (!target) return;
        const remTab = target.closest('.regime-tab');
        if (remTab instanceof HTMLElement) {
          const algoId = remTab.getAttribute('data-algo-id');
          const remaining = Number(remTab.getAttribute('data-remaining'));
          if (algoId && Number.isFinite(remaining)) {
            setRegimeRemaining({ algoId: algoId, remaining: remaining });
            remTab.blur();
          }
        }
      });
    }

    function renderRegimes(slice) {
      clearRegimeSections();
      if (!regimeSectionsHost) return;
      if (!slice.regimes || slice.regimes.length === 0) {
        regimeSectionsHost.innerHTML = '<div class="survival-empty">No regime algos computed — needs 1m candle data.</div>';
        return;
      }
      // Sort all algo sections by max lead pp descending — best
      // regime first regardless of live status. The LIVE pill on the
      // header makes live algos visually distinguishable; we don't
      // need them anchored to the top.
      const ordered = slice.regimes.slice().sort(
        (a, b) => (b.maxLeadPp ?? -Infinity) - (a.maxLeadPp ?? -Infinity),
      );
      ordered.forEach((algo) => {
        // Auto-expand only sections whose algo has at least one
        // leading regime in the live probability table — same
        // condition as the LIVE pill. Algos without live regimes
        // collapse so the operator's eye lands on what's actually
        // trading.
        const algoIsLive = liveTradingAlgoIds.indexOf(algo.id) >= 0;
        const leadingCount = !algoIsLive ? 0 : algo.buckets.reduce((acc, b) => {
          const v = (b.avgLeadPp == null || !Number.isFinite(b.avgLeadPp)) ? null : b.avgLeadPp;
          return v !== null && v >= leadingRegimeMinLeadPp ? acc + 1 : acc;
        }, 0);
        renderRegimeSection(algo, leadingCount > 0);
      });
    }

    if (filterSectionsHost) {
      filterSectionsHost.addEventListener('click', (e) => {
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (!target) return;
        const tab = target.closest('.filter-tab');
        if (!(tab instanceof HTMLElement)) return;
        const filterId = tab.getAttribute('data-filter-id');
        const remaining = Number(tab.getAttribute('data-remaining'));
        if (!filterId || !Number.isFinite(remaining)) return;
        setFilterRemaining({ filterId: filterId, remaining: remaining });
        tab.blur();
      });
    }

    function activate(asset) {
      const slice = slices.find((s) => s.asset === asset);
      if (!slice) return;
      for (const btn of tabsEl.querySelectorAll(".alea-tab")) {
        btn.classList.toggle("active", btn.getAttribute("data-asset") === asset);
      }
      titleEl.textContent = slice.assetUpper;
      metaEl.textContent = slice.yearRange ?? "";
      countEl.textContent = slice.candleCount.toLocaleString() + " candles";
      renderSurvival(slice);
      renderRegimes(slice);
      renderFilters(slice);
    }

    tabsEl.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const btn = target.closest(".alea-tab");
      if (!(btn instanceof HTMLElement)) return;
      const asset = btn.getAttribute("data-asset");
      if (!asset) return;
      activate(asset);
      btn.blur();
    });

    // Use a ResizeObserver so the chart tracks its container even when
    // window size is unchanged (e.g. flex-layout reflow on first paint).
    if (typeof ResizeObserver !== "undefined") {
      const survivalRo = new ResizeObserver(() => {
        if (!survivalChart) return;
        const w = survivalChartHost.clientWidth;
        const h = survivalChartHost.clientHeight;
        if (w > 0 && h > 0) survivalChart.setSize({ width: w, height: h });
      });
      survivalRo.observe(survivalChartHost);
      // Single ResizeObserver covers both the main chart hosts and the
      // delta-chart hosts; the entry list lets us only resize what
      // actually moved.
      const filterRo = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const host = entry.target;
          const match = filterCharts.find((fc) =>
            fc.host === host || fc.deltaHost === host,
          );
          if (!match) continue;
          const w = host.clientWidth;
          const h = host.clientHeight;
          if (w <= 0 || h <= 0) continue;
          if (host === match.host) {
            match.chart.setSize({ width: w, height: h });
          } else if (host === match.deltaHost && match.deltaChart) {
            match.deltaChart.setSize({ width: w, height: h });
          }
        }
      });
      // Attach a MutationObserver so that as new chart hosts appear
      // (when the user switches asset tabs and we re-render), we begin
      // observing them too.
      if (filterSectionsHost) {
        const mo = new MutationObserver(() => {
          const mainHosts = filterSectionsHost.querySelectorAll('.filter-chart-host');
          mainHosts.forEach((h) => filterRo.observe(h));
          const deltaHosts = filterSectionsHost.querySelectorAll('.filter-delta-host');
          deltaHosts.forEach((h) => filterRo.observe(h));
        });
        mo.observe(filterSectionsHost, { childList: true, subtree: true });
      }
      // Same machinery for regime-chart hosts.
      const regimeRo = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const host = entry.target;
          const match = regimeCharts.find((rc) => rc.host === host);
          if (!match) continue;
          const w = host.clientWidth;
          const h = host.clientHeight;
          if (w > 0 && h > 0) match.chart.setSize({ width: w, height: h });
        }
      });
      if (regimeSectionsHost) {
        const regimeMo = new MutationObserver(() => {
          const hosts = regimeSectionsHost.querySelectorAll('.regime-chart-host');
          hosts.forEach((h) => regimeRo.observe(h));
        });
        regimeMo.observe(regimeSectionsHost, { childList: true, subtree: true });
      }
    }
    window.addEventListener("resize", () => {
      if (survivalChart) survivalChart.setSize({ width: survivalChartHost.clientWidth, height: survivalChartHost.clientHeight });
      for (const entry of regimeCharts) {
        const w = entry.host.clientWidth;
        const h = entry.host.clientHeight;
        if (w > 0 && h > 0) entry.chart.setSize({ width: w, height: h });
      }
      for (const entry of filterCharts) {
        const w = entry.host.clientWidth;
        const h = entry.host.clientHeight;
        if (w > 0 && h > 0) entry.chart.setSize({ width: w, height: h });
        if (entry.deltaChart) {
          const dw = entry.deltaHost.clientWidth;
          const dh = entry.deltaHost.clientHeight;
          if (dw > 0 && dh > 0) entry.deltaChart.setSize({ width: dw, height: dh });
        }
      }
    });

    if (slices.length > 0) activate(slices[0].asset);
  </script>
</body>
</html>
`;
}

/**
 * Cross-asset summary table at the top of the page. Rows = filters,
 * columns = assets. Each cell is a population calibration % stacked
 * with the sweet-spot bp range, so the operator can scan all
 * (filter, asset) cells without flipping between tabs. The row that
 * powers live trading gets a subtle gold tint and a "LIVE" tag below
 * the filter name.
 *
 * Rendered server-side because it's purely a derived view of the
 * payload — keeps it out of the on-page JS slices and makes the
 * static HTML carry its own first-paint summary.
 */
/**
 * Top-level page navigation. Renders a horizontal bar of links — the
 * active page is the one matching `activeId`; the rest are placeholder
 * slots for future dashboards (live trading, strategy, etc.) and
 * render disabled with a "soon" tooltip until each gets its own route.
 *
 * Adding a real page: change its entry from `kind: "soon"` to
 * `kind: "ready"` and pass an `href`. Until then, every dashboard's
 * server-render emits the same nav with a different `activeId` so the
 * navigation feels persistent across pages even though each page is a
 * standalone HTML asset.
 */
type TopNavPage =
  | { readonly id: string; readonly label: string; readonly kind: "ready"; readonly href: string }
  | { readonly id: string; readonly label: string; readonly kind: "soon" };

const TOP_NAV_PAGES: readonly TopNavPage[] = [
  { id: "training", label: "Training", kind: "ready", href: "/" },
  { id: "dry-runs", label: "Dry runs", kind: "soon" },
  { id: "live", label: "Live trading", kind: "soon" },
];

function renderTopNav({
  activeId,
}: {
  readonly activeId: string;
}): string {
  const items = TOP_NAV_PAGES.map((page) => {
    const isActive = page.id === activeId;
    if (page.kind === "ready") {
      const cls = isActive ? "alea-topnav-link active" : "alea-topnav-link";
      const ariaCurrent = isActive ? ' aria-current="page"' : "";
      return `<a class="${cls}" href="${escapeHtml(page.href)}"${ariaCurrent}>${escapeHtml(page.label)}</a>`;
    }
    // Disabled placeholder — anchor with no href + role=link so screen
    // readers see it but it's not navigable.
    return (
      `<span class="alea-topnav-link disabled" title="Coming soon">` +
        `${escapeHtml(page.label)}<span class="alea-topnav-soon">soon</span>` +
      `</span>`
    );
  }).join("");
  return `<nav class="alea-topnav" aria-label="Dashboards">${items}</nav>`;
}

/**
 * Mirrors the client-side `prettyRegime` (defined inline in the
 * dashboard script) for server-rendered table rows. Both must agree
 * on the labels they emit so the cross-asset summary and the
 * per-section regime stats look the same.
 */
function prettyRegimeServer(id: string): string {
  const explicit: Record<string, string> = {
    no_trend_low_vol: "no trend · low vol",
    no_trend_high_vol: "no trend · high vol",
    with_trend_low_vol: "with trend · low vol",
    with_trend_high_vol: "with trend · high vol",
    against_trend_low_vol: "against trend · low vol",
    against_trend_high_vol: "against trend · high vol",
    no_trend: "no trend",
    with_trend: "with trend",
    against_trend: "against trend",
    weak_trend: "weak trend",
    strong_trend: "strong trend",
    low_vol: "low vol",
    mid_vol: "mid vol",
    high_vol: "high vol",
    vol_q1_lowest: "vol q1 · lowest",
    vol_q2: "vol q2",
    vol_q3: "vol q3",
    vol_q4_highest: "vol q4 · highest",
    oversold: "oversold",
    neutral: "neutral",
    overbought: "overbought",
  };
  if (explicit[id] !== undefined) return explicit[id] as string;
  return id.replace(/_/g, " ");
}

function renderCrossAssetSummary({
  slices,
}: {
  readonly slices: readonly DashboardAssetSlice[];
}): string {
  if (slices.length === 0) {return "";}

  // Collect every (algo, regime) pair that's "live" — i.e. the algo
  // is in LIVE_TRADING_REGIME_ALGOS AND the regime has avgLeadPp >=
  // LEADING_REGIME_MIN_LEAD_PP on at least one asset. For each
  // live pair, gather avgLeadPp across ALL assets (even ones below
  // threshold), so the operator sees the full distribution of
  // performance, not just the leading-asset cherrypick.
  type LivePair = {
    algoId: string;
    algoDisplayName: string;
    algoBucketCount: number;
    regime: string;
    leads: number[];
  };
  const livePairs = new Map<string, LivePair>();
  for (const slice of slices) {
    for (const algo of slice.regimes) {
      if (!LIVE_TRADING_ALGO_IDS.has(algo.id)) {continue;}
      for (const bucket of algo.buckets) {
        const lead = bucket.avgLeadPp;
        if (lead === null || !Number.isFinite(lead)) {continue;}
        const key = algo.id + "|" + bucket.regime;
        let pair = livePairs.get(key);
        if (pair === undefined) {
          pair = {
            algoId: algo.id,
            algoDisplayName: algo.displayName,
            algoBucketCount: algo.buckets.length,
            regime: bucket.regime,
            leads: [],
          };
          livePairs.set(key, pair);
        }
        pair.leads.push(lead);
      }
    }
  }
  // Filter to pairs that qualified as leading on at least one asset
  // (i.e. cleared the threshold somewhere — same rule the prob-table
  // generator uses to include the surface in the live table).
  const eligible = [...livePairs.values()].filter((p) =>
    p.leads.some((l) => l >= LEADING_REGIME_MIN_LEAD_PP),
  );
  if (eligible.length === 0) {return "";}

  function median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    if (n === 0) return Number.NaN;
    if (n % 2 === 1) return sorted[(n - 1) / 2] as number;
    return ((sorted[n / 2 - 1] as number) + (sorted[n / 2] as number)) / 2;
  }
  function mean(values: readonly number[]): number {
    if (values.length === 0) return Number.NaN;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  // Per-row stats. Sort by mean lead descending — best regime first.
  const ranked = eligible
    .map((pair) => ({
      pair,
      max: Math.max(...pair.leads),
      min: Math.min(...pair.leads),
      median: median(pair.leads),
      avg: mean(pair.leads),
    }))
    .sort((a, b) => b.avg - a.avg);

  function formatLead(pp: number): string {
    if (!Number.isFinite(pp)) return "—";
    return (pp >= 0 ? "+" : "") + pp.toFixed(1) + "pp";
  }
  function leadClass(pp: number): string {
    if (!Number.isFinite(pp)) return "ca-cell-flat";
    if (pp > 0) return "ca-cell-up";
    if (pp < 0) return "ca-cell-down";
    return "ca-cell-flat";
  }

  const rows = ranked
    .map((row) => {
      return (
        `<tr>` +
          `<th>` +
            `<div class="ca-filter-cell">` +
              `<span class="ca-row-algo">${escapeHtml(row.pair.algoDisplayName)}<span class="ca-row-buckets">[${row.pair.algoBucketCount} bucket${row.pair.algoBucketCount === 1 ? "" : "s"}]</span></span>` +
              `<span class="ca-row-regime">${escapeHtml(prettyRegimeServer(row.pair.regime))}</span>` +
            `</div>` +
          `</th>` +
          `<td><span class="ca-cell-pop ${leadClass(row.avg)}">${formatLead(row.avg)}</span></td>` +
          `<td><span class="ca-cell-pop ${leadClass(row.median)}">${formatLead(row.median)}</span></td>` +
          `<td><span class="ca-cell-pop ${leadClass(row.max)}">${formatLead(row.max)}</span></td>` +
          `<td><span class="ca-cell-pop ${leadClass(row.min)}">${formatLead(row.min)}</span></td>` +
        `</tr>`
      );
    })
    .join("");

  const hintHtml = escapeHtml(
    `Each row: a regime in the live probability table.`,
  );
  return (
    `<section class="cross-asset-summary" aria-label="Live regimes summary">` +
      `<div class="ca-title-row">` +
        `<span class="ca-title">Live regimes</span>` +
        `<span class="ca-hint">${hintHtml}</span>` +
      `</div>` +
      `<div class="ca-table-wrap">` +
        `<table>` +
          `<thead><tr><th>Algo · Regime</th><th>avg</th><th>median</th><th>max</th><th>min</th></tr></thead>` +
          `<tbody>${rows}</tbody>` +
        `</table>` +
      `</div>` +
    `</section>`
  );
}

function toDashboardSlice({
  asset,
  survival,
  filters,
  regimes,
}: {
  readonly asset: AssetSizeDistribution;
  readonly survival: AssetSurvivalDistribution | null;
  readonly filters: AssetSurvivalFilters | null;
  readonly regimes: AssetRegimeAlgos | null;
}): DashboardAssetSlice {
  const years = Object.keys(asset.byYear).sort();
  const first = years[0];
  const last = years[years.length - 1];
  const yearRange =
    first !== undefined && last !== undefined
      ? first === last
        ? first
        : `${first}–${last}`
      : null;
  return {
    asset: asset.asset,
    assetUpper: asset.asset.toUpperCase(),
    candleCount: asset.candleCount,
    yearRange,
    survival: survival === null ? null : toSurvivalSlice({ survival }),
    regimes:
      regimes === null
        ? []
        : regimes.results.map((result) => toRegimeAlgoSlice({ result })),
    filters:
      filters === null
        ? []
        : filters.results.map((result) => toFilterSlice({ result })),
  };
}

/**
 * Pivots one regime-algo result into the renderer's slice shape:
 * sweet-spot weighted per-remaining win rates per regime + algo-level
 * summary.
 */
function toRegimeAlgoSlice({
  result,
}: {
  readonly result: RegimeAlgoResult;
}): RegimeAlgoSlice {
  const distancesBp: number[] = [];
  for (let bp = 0; bp < SURVIVAL_MAX_DISTANCE_BP; bp += 1) {
    distancesBp.push(bp);
  }
  // Index baseline cells by (remaining, distanceBp) for the lead
  // computation. Baseline rates are the unconditional reference each
  // regime's average lead is measured against.
  const baselineByRemainingDistance = new Map<
    SurvivalRemainingMinutes,
    Map<number, { total: number; survived: number }>
  >();
  for (const remaining of SURVIVAL_REMAINING_ORDER) {
    const inner = new Map<number, { total: number; survived: number }>();
    for (const cell of result.baseline.byRemaining[remaining]) {
      inner.set(cell.distanceBp, { total: cell.total, survived: cell.survived });
    }
    baselineByRemainingDistance.set(remaining, inner);
  }
  const totalWindowsCount = result.buckets.reduce((acc, b) => acc + b.windowCount, 0);
  const unsortedBuckets: RegimeBucketSlice[] = result.buckets.map((bucket) => {
    // avgLeadPp: sample-weighted (by regime cell sample count) average
    // of (regime hold rate − baseline hold rate) across cells where
    // both clear the sample floor and the distance is actionable.
    let leadNumerator = 0;
    let leadDenominator = 0;
    for (const remaining of SURVIVAL_REMAINING_ORDER) {
      const baselineInner = baselineByRemainingDistance.get(remaining);
      if (baselineInner === undefined) continue;
      for (const cell of bucket.surface.byRemaining[remaining]) {
        if (cell.distanceBp < MIN_ACTIONABLE_DISTANCE_BP) continue;
        if (cell.total < REGIME_CELL_MIN_SAMPLES) continue;
        const baselineCell = baselineInner.get(cell.distanceBp);
        if (baselineCell === undefined || baselineCell.total < REGIME_CELL_MIN_SAMPLES) {
          continue;
        }
        const regimeRate = (cell.survived / cell.total) * 100;
        const baselineRate =
          (baselineCell.survived / baselineCell.total) * 100;
        const deltaPp = regimeRate - baselineRate;
        leadNumerator += deltaPp * cell.total;
        leadDenominator += cell.total;
      }
    }
    const avgLeadPp = leadDenominator === 0 ? null : leadNumerator / leadDenominator;
    return {
      regime: bucket.regime,
      windowShare: totalWindowsCount === 0 ? 0 : bucket.windowCount / totalWindowsCount,
      snapshotsTotal: bucket.snapshotsTotal,
      avgLeadPp,
      surface: densifySurface({ surface: bucket.surface, distancesBp }),
    };
  });
  // Sort buckets by avgLeadPp descending — best regime first. Tie-
  // breaker: bigger windowShare wins (a regime that fires more often
  // is more impactful at the same lead). Stats row, chart legend,
  // chart series order all inherit this.
  const buckets: RegimeBucketSlice[] = unsortedBuckets.slice().sort((a, b) => {
    const la = a.avgLeadPp ?? Number.NEGATIVE_INFINITY;
    const lb = b.avgLeadPp ?? Number.NEGATIVE_INFINITY;
    if (lb !== la) return lb - la;
    return b.windowShare - a.windowShare;
  });
  // maxLeadPp = best regime's avgLeadPp. Algo headline.
  let maxLeadPp: number | null = null;
  for (const b of buckets) {
    if (b.avgLeadPp === null) continue;
    if (maxLeadPp === null || b.avgLeadPp > maxLeadPp) {
      maxLeadPp = b.avgLeadPp;
    }
  }
  return {
    id: result.id,
    displayName: result.displayName,
    description: result.description,
    params: result.params,
    snapshotsTotal: result.summary.snapshotsTotal,
    snapshotsClassified: result.summary.snapshotsClassified,
    snapshotsSkipped: result.summary.snapshotsSkipped,
    maxLeadPp,
    distancesBp,
    baseline: densifySurface({ surface: result.baseline, distancesBp }),
    buckets,
  };
}

/**
 * Pivots one filter result into chart-ready densified arrays. Same
 * densification pattern as `toSurvivalSlice`, run three times — once per
 * surface (baseline / whenTrue / whenFalse) — so the chart can iterate a
 * shared x-axis with `null` gaps for sparse buckets.
 *
 * Also picks the default remaining-minutes tab: the bucket where the
 * filter most strongly tightens the point of no return.
 */
function toFilterSlice({
  result,
}: {
  readonly result: SurvivalFilterResultPayload;
}): FilterSlice {
  const distancesBp: number[] = [];
  for (let bp = 0; bp < SURVIVAL_MAX_DISTANCE_BP; bp += 1) {
    distancesBp.push(bp);
  }
  return {
    id: result.id,
    displayName: result.displayName,
    description: result.description,
    trueLabel: result.trueLabel,
    falseLabel: result.falseLabel,
    distancesBp,
    baseline: densifySurface({ surface: result.baseline, distancesBp }),
    whenTrue: densifySurface({ surface: result.whenTrue, distancesBp }),
    whenFalse: densifySurface({ surface: result.whenFalse, distancesBp }),
    summary: {
      snapshotsTrue: result.summary.snapshotsTrue,
      snapshotsFalse: result.summary.snapshotsFalse,
      snapshotsSkipped: result.summary.snapshotsSkipped,
      occurrenceTrue: result.summary.occurrenceTrue,
      occurrenceFalse: result.summary.occurrenceFalse,
      calibrationScore: result.summary.calibrationScore,
      calibrationScoreByRemaining: result.summary.calibrationScoreByRemaining,
      sweetSpot: result.summary.sweetSpot,
      scoresByRemaining: result.summary.scoresByRemaining,
    },
    // Always default to 4m left so the operator opens every filter
    // section to a consistent reference column. The previous
    // "auto-pick the strongest signal" behaviour made cross-filter
    // comparison harder because each section could open to a
    // different remaining-minutes bucket.
    defaultRemaining: 4,
  };
}

function densifySurface({
  surface,
  distancesBp,
}: {
  readonly surface: SurvivalSurfaceWithCount;
  readonly distancesBp: readonly number[];
}): FilterSurfaceArrays {
  const out = {} as Record<
    SurvivalRemainingMinutes,
    { winRate: (number | null)[]; sampleCount: number[] }
  >;
  for (const remaining of SURVIVAL_REMAINING_ORDER) {
    const buckets = surface.byRemaining[remaining];
    const byDistance = new Map<number, { total: number; survived: number }>();
    for (const bucket of buckets) {
      byDistance.set(bucket.distanceBp, {
        total: bucket.total,
        survived: bucket.survived,
      });
    }
    const winRate: (number | null)[] = [];
    const sampleCount: number[] = [];
    for (const bp of distancesBp) {
      const bucket = byDistance.get(bp);
      if (bucket === undefined || bucket.total === 0) {
        winRate.push(null);
        sampleCount.push(0);
        continue;
      }
      sampleCount.push(bucket.total);
      if (bucket.total < REGIME_CELL_MIN_SAMPLES) {
        winRate.push(null);
        continue;
      }
      winRate.push((bucket.survived / bucket.total) * 100);
    }
    out[remaining] = { winRate, sampleCount };
  }
  return out;
}

/**
 * Pivots the per-asset survival distribution into chart-ready arrays
 * indexed by `distancesBp` (0..MAX-1, every integer bp). The compute step
 * stores buckets as a sparse list keyed by distance; here we densify so
 * the chart can iterate a fixed x-axis. Buckets below the sample-count
 * floor are kept as `null` win-rate values (rendered as gaps) but their
 * raw `sampleCount` is preserved for tooltips.
 */
function toSurvivalSlice({
  survival,
}: {
  readonly survival: AssetSurvivalDistribution;
}): SurvivalSlice {
  const distancesBp: number[] = [];
  for (let bp = 0; bp < SURVIVAL_MAX_DISTANCE_BP; bp += 1) {
    distancesBp.push(bp);
  }
  const byRemaining = {} as Record<
    SurvivalRemainingMinutes,
    { winRate: (number | null)[]; sampleCount: number[] }
  >;
  for (const remaining of SURVIVAL_REMAINING_ORDER) {
    const buckets = survival.all.byRemaining[remaining];
    const byDistance = new Map<number, { total: number; survived: number }>();
    for (const bucket of buckets) {
      byDistance.set(bucket.distanceBp, {
        total: bucket.total,
        survived: bucket.survived,
      });
    }
    const winRate: (number | null)[] = [];
    const sampleCount: number[] = [];
    for (const bp of distancesBp) {
      const bucket = byDistance.get(bp);
      if (bucket === undefined || bucket.total === 0) {
        winRate.push(null);
        sampleCount.push(0);
        continue;
      }
      sampleCount.push(bucket.total);
      if (bucket.total < REGIME_CELL_MIN_SAMPLES) {
        winRate.push(null);
        continue;
      }
      winRate.push((bucket.survived / bucket.total) * 100);
    }
    byRemaining[remaining] = { winRate, sampleCount };
  }
  return {
    windowCount: survival.windowCount,
    distancesBp,
    byRemaining,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Formats the run timestamp as `YYYY-MM-DD @ HH:MM` in the local timezone
 * of the machine that ran the CLI. No timezone label — the operator opens
 * the HTML on their own clock and doesn't need a reminder.
 */
function formatGeneratedAt(ms: number): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} @ ${get("hour")}:${get("minute")}`;
}
