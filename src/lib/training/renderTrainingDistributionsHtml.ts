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
  assets,
}: {
  readonly payload: TrainingDistributionsPayload;
  /**
   * Relative hrefs (resolved by `copyDashboardAssets`) for the
   * stylesheets and scripts the rendered HTML should reference.
   * Stylesheets cascade in the order given, after the design-system
   * fonts; scripts execute in order, after the inline payload.
   */
  readonly assets: {
    readonly stylesheets: readonly string[];
    readonly scripts: readonly string[];
  };
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

  const trainingPayload = {
    slices,
    chartTokens: aleaChartTokens,
    survivalRemainingOrder: SURVIVAL_REMAINING_ORDER,
    survivalRemainingColors: SURVIVAL_REMAINING_COLORS,
    regimeCellMinSamples: REGIME_CELL_MIN_SAMPLES,
    minActionableDistanceBp: MIN_ACTIONABLE_DISTANCE_BP,
    survivalXAxisPadBp: SURVIVAL_X_AXIS_PAD_BP,
    liveTradingAlgoIds: [...LIVE_TRADING_ALGO_IDS],
    leadingRegimeMinLeadPp: LEADING_REGIME_MIN_LEAD_PP,
    filterColors: FILTER_COLORS,
    deltaColors: DELTA_COLORS,
  };
  // Embed JSON inside <script type="application/json"> so the page can
  // pass the payload to the static training-distributions.js without
  // serializing-into-JS-source escape hazards. We only need to escape
  // `</` (the only sequence that could close the script tag).
  const trainingPayloadJson = JSON.stringify(trainingPayload).replace(
    /<\/(script)/gi,
    "<\\/$1",
  );

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alea · Hold-rate by distance, time, and regime</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.min.css" />
  <script src="https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.iife.min.js" charset="utf-8"></script>
  ${aleaDesignSystemHead({ stylesheets: assets.stylesheets })}
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
  <script id="training-payload" type="application/json">${trainingPayloadJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
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
  if (explicit[id] !== undefined) {return explicit[id];}
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
    if (n === 0) {return Number.NaN;}
    if (n % 2 === 1) {return sorted[(n - 1) / 2] as number;}
    return ((sorted[n / 2 - 1] as number) + (sorted[n / 2] as number)) / 2;
  }
  function mean(values: readonly number[]): number {
    if (values.length === 0) {return Number.NaN;}
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
    if (!Number.isFinite(pp)) {return "—";}
    return (pp >= 0 ? "+" : "") + pp.toFixed(1) + "pp";
  }
  function leadClass(pp: number): string {
    if (!Number.isFinite(pp)) {return "ca-cell-flat";}
    if (pp > 0) {return "ca-cell-up";}
    if (pp < 0) {return "ca-cell-down";}
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
      if (baselineInner === undefined) {continue;}
      for (const cell of bucket.surface.byRemaining[remaining]) {
        if (cell.distanceBp < MIN_ACTIONABLE_DISTANCE_BP) {continue;}
        if (cell.total < REGIME_CELL_MIN_SAMPLES) {continue;}
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
    if (lb !== la) {return lb - la;}
    return b.windowShare - a.windowShare;
  });
  // maxLeadPp = best regime's avgLeadPp. Algo headline.
  let maxLeadPp: number | null = null;
  for (const b of buckets) {
    if (b.avgLeadPp === null) {continue;}
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
