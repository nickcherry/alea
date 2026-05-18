import type {
  ProxyAccuracyAggregate,
  ProxyAccuracyDisagreement,
  ProxyAccuracyPayload,
  ProxyAccuracyTimeframeBreakdown,
  ProxyMoveBucket,
} from "@alea/lib/polymarket/dashboard/types";
import {
  aleaBrandMark,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import { infoTip } from "@alea/lib/ui/aleaFormat";
import { renderTopNav } from "@alea/lib/ui/topNav";
import type { ResolutionTimeframe } from "@alea/types/resolutions";

/** Renders the proxy-accuracy dashboard. */
export function renderProxyAccuracyHtml({
  payload,
  assets,
}: {
  readonly payload: ProxyAccuracyPayload;
  readonly assets: {
    readonly stylesheets: readonly string[];
    readonly scripts: readonly string[];
  };
}): string {
  const subtitle = `generated ${formatDateTime({ ms: payload.generatedAtMs })}`;
  const payloadJson = escapeJsonForHtml({ value: JSON.stringify(payload) });

  const initialTimeframe: ResolutionTimeframe =
    payload.breakdowns[0]?.timeframe ?? "1h";

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alea &middot; Proxy</title>
  ${aleaDesignSystemHead({ stylesheets: assets.stylesheets })}
</head>
<body>
  <div class="alea-shell">
    <header class="alea-header">
      <div class="alea-brand-row">${aleaBrandMark()}</div>
      <h1 class="alea-title">Proxy Accuracy</h1>
      <p class="alea-subtitle">${subtitle}</p>
    </header>
    ${renderTopNav({ activeId: "proxy" })}
    <main class="alea-main">
      ${renderTimeframeControls({ payload, initialTimeframe })}

      ${payload.breakdowns
        .map((b) =>
          renderTimeframeSection({
            breakdown: b,
            isActive: b.timeframe === initialTimeframe,
          }),
        )
        .join("\n")}

      <section class="proxy-section">
        <div class="alea-section-rule"><h2>Top Disagreements</h2></div>
        <div id="proxy-extreme-host">${renderExtremeTable({
          rows: payload.extremeDisagreements.filter(
            (d) => d.timeframe === initialTimeframe,
          ),
        })}</div>
      </section>
    </main>
  </div>
  <script id="proxy-accuracy-payload" type="application/json">${payloadJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>`;
}

function renderTimeframeControls({
  payload,
  initialTimeframe,
}: {
  readonly payload: ProxyAccuracyPayload;
  readonly initialTimeframe: ResolutionTimeframe;
}): string {
  if (payload.breakdowns.length <= 1) {
    return "";
  }
  return `<div class="alea-page-controls">
        <div class="alea-pill-tabs" role="tablist" aria-label="Market timeframe">
          ${payload.breakdowns
            .map(
              (b) =>
                `<button class="alea-pill-tab is-prominent proxy-period-tab" role="tab" data-period="${b.timeframe}" aria-selected="${b.timeframe === initialTimeframe ? "true" : "false"}">${b.timeframe}</button>`,
            )
            .join("\n          ")}
        </div>
      </div>`;
}

function renderTimeframeSection({
  breakdown,
  isActive,
}: {
  readonly breakdown: ProxyAccuracyTimeframeBreakdown;
  readonly isActive: boolean;
}): string {
  const hidden = isActive ? "" : ' hidden="hidden"';
  return `
      <section class="proxy-section proxy-timeframe-section" data-period="${breakdown.timeframe}"${hidden}>
        <div class="alea-section-rule"><h2>${breakdown.timeframe.toUpperCase()} Markets</h2></div>
        <div class="proxy-aggregate-grid">
          ${renderAggregate({ aggregate: breakdown.aggregate })}
          <div class="proxy-buckets">
            ${renderBucketBlock({
              title: "Disagreements by Pyth move size",
              buckets: breakdown.aggregate.moveBucketsDisagree,
              total: breakdown.aggregate.disagreed,
              empty:
                "No disagreements — Pyth matches Polymarket on every window.",
            })}
            ${renderBucketBlock({
              title: "All windows by Pyth move size",
              buckets: breakdown.moveBucketsAll,
              total: breakdown.aggregate.total,
            })}
          </div>
        </div>
        ${renderPerAssetTable({ breakdown })}
      </section>
  `;
}

function renderAggregate({
  aggregate,
}: {
  readonly aggregate: ProxyAccuracyAggregate;
}): string {
  const rate =
    aggregate.agreementRate === null
      ? "—"
      : `${(aggregate.agreementRate * 100).toFixed(2)}%`;
  const tone = agreementTone({ rate: aggregate.agreementRate });
  const toneClass =
    tone === "positive"
      ? " alea-num-positive"
      : tone === "negative"
        ? " alea-num-negative"
        : "";
  return `
    <dl class="proxy-aggregate">
      <div>
        <dt>Agreement</dt>
        <dd class="alea-mono${toneClass}">${rate}</dd>
        <dd class="proxy-aggregate-sub alea-mono">${aggregate.agreed.toLocaleString()} / ${aggregate.total.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Disagreements</dt>
        <dd class="alea-mono">${aggregate.disagreed.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Clear-move</dt>
        <dd class="alea-mono">${aggregate.clearDisagreements.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Median |move|</dt>
        <dd class="alea-mono">${formatBp({ pct: aggregate.disagreeMedianMovePct })}</dd>
      </div>
      <div>
        <dt>P90 |move|</dt>
        <dd class="alea-mono">${formatBp({ pct: aggregate.disagreeP90MovePct })}</dd>
      </div>
    </dl>
  `;
}

function renderBucketBlock({
  title,
  buckets,
  total,
  empty,
}: {
  readonly title: string;
  readonly buckets: readonly ProxyMoveBucket[];
  readonly total: number;
  readonly empty?: string;
}): string {
  if (total === 0 && empty !== undefined) {
    return `
      <div class="proxy-bucket-block">
        <p class="proxy-bucket-title">${escapeHtml({ value: title })}</p>
        <p class="proxy-muted">${escapeHtml({ value: empty })}</p>
      </div>
    `;
  }
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return `
    <div class="proxy-bucket-block">
      <p class="proxy-bucket-title">${escapeHtml({ value: title })}</p>
      <div class="proxy-bucket-list">
        ${buckets
          .map((bucket) => {
            const pct = total === 0 ? 0 : (bucket.count / total) * 100;
            const widthPct = (bucket.count / max) * 100;
            return `
              <div class="proxy-bucket-row">
                <span class="proxy-bucket-label">${escapeHtml({ value: bucket.label })}</span>
                <span class="proxy-bucket-track">
                  <span class="proxy-bucket-fill" style="width:${widthPct.toFixed(1)}%"></span>
                </span>
                <span class="proxy-bucket-count alea-mono">${bucket.count.toLocaleString()}</span>
                <span class="proxy-bucket-share alea-muted alea-mono">${pct.toFixed(1)}%</span>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderPerAssetTable({
  breakdown,
}: {
  readonly breakdown: ProxyAccuracyTimeframeBreakdown;
}): string {
  if (breakdown.perAsset.length === 0) {
    return "";
  }
  return `
    <div class="alea-table-wrap proxy-asset-table-wrap">
      <table class="alea-table proxy-asset-table">
        <thead>
          <tr>
            <th>Asset${infoTip({ text: PER_ASSET_TIPS.asset })}</th>
            <th class="num-col">Windows${infoTip({ text: PER_ASSET_TIPS.windows })}</th>
            <th class="num-col">Agreement${infoTip({ text: PER_ASSET_TIPS.agreement })}</th>
            <th class="num-col">Disagreements${infoTip({ text: PER_ASSET_TIPS.disagreements })}</th>
            <th class="num-col">Clear-move${infoTip({ text: PER_ASSET_TIPS.clearMove })}</th>
            <th class="num-col">Below threshold${infoTip({ text: PER_ASSET_TIPS.belowThreshold })}</th>
            <th class="num-col">Median |move%|${infoTip({ text: PER_ASSET_TIPS.medianMove })}</th>
            <th class="num-col">P90 |move%|${infoTip({ text: PER_ASSET_TIPS.p90Move })}</th>
          </tr>
        </thead>
        <tbody>
          ${breakdown.perAsset
            .map((row) => {
              const rate = row.aggregate.agreementRate;
              const tone = agreementTone({ rate });
              const cls =
                tone === "positive"
                  ? " alea-num-positive"
                  : tone === "negative"
                    ? " alea-num-negative"
                    : "";
              const rateStr =
                rate === null ? "—" : `${(rate * 100).toFixed(2)}%`;
              const belowClearShare = row.aggregate.disagreeBelowClearShare;
              return `
                <tr>
                  <td><span class="asset-pill">${escapeHtml({ value: row.asset })}</span></td>
                  <td class="num-col alea-mono">${row.aggregate.total.toLocaleString()}</td>
                  <td class="num-col alea-mono${cls}">${rateStr}</td>
                  <td class="num-col alea-mono">${row.aggregate.disagreed.toLocaleString()}</td>
                  <td class="num-col alea-mono">${row.aggregate.clearDisagreements.toLocaleString()}</td>
                  <td class="num-col alea-mono">${belowClearShare === null ? "—" : `${(belowClearShare * 100).toFixed(1)}%`}</td>
                  <td class="num-col alea-mono">${formatBp({ pct: row.aggregate.disagreeMedianMovePct })}</td>
                  <td class="num-col alea-mono">${formatBp({ pct: row.aggregate.disagreeP90MovePct })}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderExtremeTable({
  rows,
}: {
  readonly rows: readonly ProxyAccuracyDisagreement[];
}): string {
  if (rows.length === 0) {
    return '<p class="proxy-muted">No disagreements yet.</p>';
  }
  return `
    <div class="alea-table-wrap">
      <table class="alea-table proxy-extreme-table">
        <thead>
          <tr>
            <th>Time${infoTip({ text: EXTREME_TIPS.time })}</th>
            <th>Asset${infoTip({ text: EXTREME_TIPS.asset })}</th>
            <th>Polymarket${infoTip({ text: EXTREME_TIPS.polymarket })}</th>
            <th>Pyth${infoTip({ text: EXTREME_TIPS.pyth })}</th>
            <th class="num-col">Open${infoTip({ text: EXTREME_TIPS.open })}</th>
            <th class="num-col">Close${infoTip({ text: EXTREME_TIPS.close })}</th>
            <th class="num-col">|move%|${infoTip({ text: EXTREME_TIPS.movePct })}</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td class="alea-mono">${escapeHtml({ value: formatWindowStart({ ms: row.windowStartTsMs }) })}</td>
                  <td><span class="asset-pill">${escapeHtml({ value: row.asset })}</span></td>
                  <td>${outcomeBadge({ outcome: row.polyOutcome })}</td>
                  <td>${outcomeBadge({ outcome: row.pythOutcome })}</td>
                  <td class="num-col alea-mono">${row.pythOpen.toFixed(4)}</td>
                  <td class="num-col alea-mono">${row.pythClose.toFixed(4)}</td>
                  <td class="num-col alea-mono">${formatBp({ pct: row.absMovePct })}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

const PER_ASSET_TIPS = {
  asset: "Crypto symbol the up/down market settled on.",
  windows:
    "Number of resolution windows we have both a Polymarket outcome and a Pyth open/close for in this timeframe.",
  agreement:
    "Share of windows where Pyth and Polymarket give the same direction. Higher is better — it means Pyth is a faithful proxy for Polymarket's Chainlink settlement.",
  disagreements:
    "Windows where Pyth said one direction but Polymarket resolved the other.",
  clearMove:
    "Disagreements where the Pyth move was large enough that the direction should have been unambiguous — these are the worrying ones.",
  belowThreshold:
    "Share of disagreements where the Pyth move was small enough that noise or fee/dust could have flipped the call.",
  medianMove:
    "Median absolute Pyth move (open → close) across disagreements, in basis points.",
  p90Move:
    "90th-percentile absolute Pyth move across disagreements — the long-tail magnitude of mismatched calls.",
} as const;

const EXTREME_TIPS = {
  time: "Start of the resolution window.",
  asset: "Crypto symbol the market settled on.",
  polymarket:
    "Direction Polymarket resolved to (up / down / flat), derived from Chainlink Data Streams.",
  pyth: "Direction Pyth's open → close move implies.",
  open: "Pyth price at the window start.",
  close: "Pyth price at the window end.",
  movePct: "Absolute Pyth open-to-close move, in basis points.",
} as const;

function outcomeBadge({
  outcome,
}: {
  readonly outcome: "up" | "down";
}): string {
  if (outcome === "up") {
    return '<span class="alea-num-positive">UP</span>';
  }
  return '<span class="alea-num-negative">DOWN</span>';
}

function agreementTone({
  rate,
}: {
  readonly rate: number | null;
}): "positive" | "negative" | "neutral" {
  if (rate === null) {
    return "neutral";
  }
  if (rate >= 0.99) {
    return "positive";
  }
  if (rate < 0.97) {
    return "negative";
  }
  return "neutral";
}

function formatBp({ pct }: { readonly pct: number | null }): string {
  if (pct === null) {
    return "—";
  }
  const bp = pct * 100;
  if (bp >= 100) {
    return `${(bp / 100).toFixed(2)}%`;
  }
  if (bp >= 10) {
    return `${bp.toFixed(1)} bp`;
  }
  return `${bp.toFixed(2)} bp`;
}

function formatDateTime({ ms }: { readonly ms: number }): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "unknown";
  }
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWindowStart({ ms }: { readonly ms: number }): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function escapeHtml({ value }: { readonly value: string }): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeJsonForHtml({ value }: { readonly value: string }): string {
  return value.replaceAll("<", "\\u003c");
}
