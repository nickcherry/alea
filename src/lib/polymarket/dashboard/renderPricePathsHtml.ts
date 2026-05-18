import type {
  PricePathsPayload,
  PricePathTimeframeBreakdown,
} from "@alea/lib/polymarket/dashboard/types";
import {
  aleaBrandMark,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import { renderTopNav } from "@alea/lib/ui/topNav";

export function renderPricePathsHtml({
  payload,
  assets,
}: {
  readonly payload: PricePathsPayload;
  readonly assets: {
    readonly stylesheets: readonly string[];
    readonly scripts: readonly string[];
  };
}): string {
  const subtitle =
    `generated ${formatDateTime({ ms: payload.generatedAtMs })}` +
    ` <span class="sep">/</span> ${payload.sampleCount.toLocaleString()} samples`;
  const payloadJson = escapeJsonForHtml({ value: JSON.stringify(payload) });
  const initialBreakdown = initialTimeframeBreakdown({ payload });

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alea &middot; Price Paths</title>
  ${aleaDesignSystemHead({ stylesheets: assets.stylesheets })}
</head>
<body>
  <div class="alea-shell">
    <header class="alea-header">
      <div class="alea-brand-row">${aleaBrandMark()}</div>
      <h1 class="alea-title">Price Paths</h1>
      <p class="alea-subtitle">${subtitle}</p>
    </header>
    ${renderTopNav({ activeId: "price-paths" })}
    <main class="alea-main">
      ${renderControls({ payload, initialBreakdown })}

      <section class="price-path-section">
        <div class="alea-section-rule"><h2>Price Distribution</h2></div>
        <div class="price-path-heatmap-wrap">
          <canvas id="price-path-heatmap" class="price-path-heatmap" aria-label="UP price distribution heatmap"></canvas>
          <div id="price-path-tooltip" class="alea-tooltip"></div>
        </div>
        <p id="price-path-empty" class="price-path-empty"${payload.sampleCount === 0 ? "" : ' hidden="hidden"'}>
          No sampled Polymarket price paths yet. Run <span class="alea-mono">bun alea polymarket:price-sample</span> to populate this page.
        </p>
      </section>

      <section class="price-path-section">
        <div class="alea-section-rule"><h2>Band Decay</h2></div>
        <div class="price-path-band-chart-wrap">
          <div id="price-path-band-chart" class="price-path-band-chart"></div>
          <div id="price-path-band-tooltip" class="alea-tooltip"></div>
        </div>
      </section>

      <section class="price-path-section">
        <div class="alea-section-rule"><h2>50c Crossings</h2></div>
        <div class="price-path-crossings-chart-wrap">
          <div id="price-path-crossings-chart" class="price-path-crossings-chart"></div>
          <div id="price-path-crossings-tooltip" class="alea-tooltip"></div>
        </div>
      </section>

      <section class="price-path-section">
        <div class="alea-section-rule"><h2>Pre-close Pyth Drift</h2></div>
        <p class="price-path-section-note">
          Share of historic Pyth candles whose price <span class="alea-mono">N</span> minutes
          before close was within <span class="alea-mono">≤2 / ≤5 / ≤10 bps</span> of
          the eventual close. Higher = the price has effectively settled by that
          point in the candle's life.
        </p>
        <div class="price-path-drift-chart-wrap">
          <div id="price-path-drift-shares-chart" class="price-path-drift-chart"></div>
          <div id="price-path-drift-shares-tooltip" class="alea-tooltip"></div>
        </div>
        <p id="price-path-drift-empty" class="price-path-empty" hidden="hidden">
          No 1m Pyth candles found for the analysis window. Run <span class="alea-mono">bun alea candles:sync --timeframe 1m --sources pyth --products spot</span> to populate this section.
        </p>
      </section>

      <section class="price-path-section">
        <div class="alea-section-rule"><h2>Pre-close Direction Flip</h2></div>
        <p class="price-path-section-note">
          Share of historic Pyth candles whose price <span class="alea-mono">N</span> minutes
          before close was on the <em>opposite</em> side of the candle's open
          from where it eventually closed — i.e., the candle went on to flip
          up/down direction in those final minutes. Lower = the candle's
          direction is already locked by that point.
        </p>
        <div class="price-path-drift-chart-wrap">
          <div id="price-path-flip-share-chart" class="price-path-drift-chart"></div>
          <div id="price-path-flip-share-tooltip" class="alea-tooltip"></div>
        </div>
      </section>
    </main>
  </div>
  <script id="price-paths-payload" type="application/json">${payloadJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>`;
}

function renderControls({
  payload,
  initialBreakdown,
}: {
  readonly payload: PricePathsPayload;
  readonly initialBreakdown: PricePathTimeframeBreakdown | null;
}): string {
  const timeframeControls =
    payload.breakdowns.length <= 1
      ? ""
      : `<div class="alea-pill-tabs" role="tablist" aria-label="Market timeframe">
          ${payload.breakdowns
            .map(
              (b) =>
                `<button class="alea-pill-tab is-prominent price-path-period-tab" role="tab" data-period="${b.timeframe}" aria-selected="${b.timeframe === initialBreakdown?.timeframe ? "true" : "false"}">${b.timeframe}</button>`,
            )
            .join("\n          ")}
        </div>`;
  return `<div class="alea-page-controls price-path-controls">
        ${timeframeControls}
        <label class="price-path-select-wrap alea-page-controls-right">
          <span>Asset</span>
          <select id="price-path-asset-select">
            ${renderAssetOptions({ breakdown: initialBreakdown })}
          </select>
        </label>
      </div>`;
}

function initialTimeframeBreakdown({
  payload,
}: {
  readonly payload: PricePathsPayload;
}): PricePathTimeframeBreakdown | null {
  return (
    payload.breakdowns.find((b) => (b.slices[0]?.sampleCount ?? 0) > 0) ??
    payload.breakdowns[0] ??
    null
  );
}

function renderAssetOptions({
  breakdown,
}: {
  readonly breakdown: PricePathTimeframeBreakdown | null;
}): string {
  if (breakdown === null) {
    return `<option value="all">All assets</option>`;
  }
  return breakdown.slices
    .map((slice) => {
      const value = slice.asset ?? "all";
      return `<option value="${escapeHtml({ value })}">${escapeHtml({
        value: slice.label,
      })}</option>`;
    })
    .join("\n            ");
}

function formatDateTime({ ms }: { readonly ms: number }): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function escapeJsonForHtml({ value }: { readonly value: string }): string {
  return value.replace(/</g, "\\u003c");
}

function escapeHtml({ value }: { readonly value: string }): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
