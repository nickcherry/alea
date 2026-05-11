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
    payload.breakdowns[0]?.timeframe ?? "5m";

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
      <div class="proxy-period-row">
        <div class="alea-pill-tabs" role="tablist" aria-label="Candle period">
          ${["5m", "15m"]
            .map(
              (tf) =>
                `<button class="alea-pill-tab is-prominent proxy-period-tab" role="tab" data-period="${tf}" aria-selected="${tf === initialTimeframe ? "true" : "false"}">${tf}</button>`,
            )
            .join("\n          ")}
        </div>
      </div>

      ${payload.breakdowns
        .map((b) =>
          renderTimeframeSection({
            breakdown: b,
            isActive: b.timeframe === initialTimeframe,
          }),
        )
        .join("\n")}

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Top Disagreements</h2></div>
        <p class="proxy-muted">
          The biggest |move%| Pyth bars where Polymarket settled the other
          way. These are the audit cases — if a row's move% is well above
          the training threshold, Pyth would have trained or traded
          opposite the actual settled side for that window.
        </p>
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

function renderTimeframeSection({
  breakdown,
  isActive,
}: {
  readonly breakdown: ProxyAccuracyTimeframeBreakdown;
  readonly isActive: boolean;
}): string {
  const totalLabel = breakdown.aggregate.total.toLocaleString();
  const hidden = isActive ? "" : ' hidden="hidden"';
  return `
      <section class="alea-card with-corners proxy-timeframe-section" data-period="${breakdown.timeframe}"${hidden}>
        <div class="alea-section-rule"><h2>${breakdown.timeframe.toUpperCase()} Markets</h2></div>
        <p class="proxy-muted">Joined windows: ${totalLabel}.</p>
        <div class="proxy-aggregate-grid">
          ${renderAggregateCard({
            title: "Overall",
            aggregate: breakdown.aggregate,
          })}
          <div class="proxy-buckets">
            ${renderBucketBlock({
              title: "Disagreements by Pyth move size",
              buckets: breakdown.aggregate.moveBucketsDisagree,
              total: breakdown.aggregate.disagreed,
              tip: PA_TIPS.bucketsDisagree,
              empty:
                "No disagreements in this timeframe — Pyth matches Polymarket on every joined window.",
            })}
            ${renderBucketBlock({
              title: "All windows by Pyth move size",
              buckets: breakdown.moveBucketsAll,
              total: breakdown.aggregate.total,
              tip: PA_TIPS.bucketsAll,
            })}
          </div>
        </div>
        ${renderPerAssetTable({ breakdown })}
      </section>
  `;
}

function renderAggregateCard({
  title,
  aggregate,
}: {
  readonly title: string;
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
  const meanPct = aggregate.disagreeMeanMovePct;
  const medianPct = aggregate.disagreeMedianMovePct;
  const p90Pct = aggregate.disagreeP90MovePct;
  const belowClearShare = aggregate.disagreeBelowClearShare;
  return `
    <div class="proxy-aggregate alea-card">
      <p class="proxy-aggregate-title">${escapeHtml({ value: title })}</p>
      <div class="proxy-headline${toneClass}">${rate}</div>
      <p class="proxy-headline-sub">
        ${aggregate.agreed.toLocaleString()} of ${aggregate.total.toLocaleString()} agreed
      </p>
      <dl class="proxy-stats">
        <div>
          <dt>Disagreements${tip({ text: PA_TIPS.disagreeTotal })}</dt>
          <dd class="alea-mono">${aggregate.disagreed.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Clear-move disagreements${tip({ text: PA_TIPS.clearDisagree })}</dt>
          <dd class="alea-mono">${aggregate.clearDisagreements.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Below threshold share${tip({ text: PA_TIPS.belowClear })}</dt>
          <dd class="alea-mono">${belowClearShare === null ? "—" : `${(belowClearShare * 100).toFixed(1)}%`}</dd>
        </div>
        <div>
          <dt>Disagree mean${tip({ text: PA_TIPS.disagreeMean })}</dt>
          <dd class="alea-mono">${formatBp({ pct: meanPct })}</dd>
        </div>
        <div>
          <dt>Disagree median${tip({ text: PA_TIPS.disagreeMedian })}</dt>
          <dd class="alea-mono">${formatBp({ pct: medianPct })}</dd>
        </div>
        <div>
          <dt>Disagree p90${tip({ text: PA_TIPS.disagreeP90 })}</dt>
          <dd class="alea-mono">${formatBp({ pct: p90Pct })}</dd>
        </div>
      </dl>
    </div>
  `;
}

function renderBucketBlock({
  title,
  buckets,
  total,
  tip: tipText,
  empty,
}: {
  readonly title: string;
  readonly buckets: readonly ProxyMoveBucket[];
  readonly total: number;
  readonly tip: string;
  readonly empty?: string;
}): string {
  if (total === 0 && empty !== undefined) {
    return `
      <div class="proxy-bucket-block">
        <p class="proxy-bucket-title">${escapeHtml({ value: title })}${tip({ text: tipText })}</p>
        <p class="proxy-muted">${escapeHtml({ value: empty })}</p>
      </div>
    `;
  }
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return `
    <div class="proxy-bucket-block">
      <p class="proxy-bucket-title">${escapeHtml({ value: title })}${tip({ text: tipText })}</p>
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
            <th>Asset${tip({ text: PA_TIPS.asset })}</th>
            <th class="num-col">Windows${tip({ text: PA_TIPS.windows })}</th>
            <th class="num-col">Agreement${tip({ text: PA_TIPS.agreement })}</th>
            <th class="num-col">Disagreements${tip({ text: PA_TIPS.disagreeTotal })}</th>
            <th class="num-col">Clear-move${tip({ text: PA_TIPS.clearDisagree })}</th>
            <th class="num-col">Below threshold${tip({ text: PA_TIPS.belowClear })}</th>
            <th class="num-col">Median |move%|${tip({ text: PA_TIPS.disagreeMedian })}</th>
            <th class="num-col">P90 |move%|${tip({ text: PA_TIPS.disagreeP90 })}</th>
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
            <th>Time${tip({ text: PA_TIPS.windowTime })}</th>
            <th>Asset${tip({ text: PA_TIPS.asset })}</th>
            <th>Polymarket${tip({ text: PA_TIPS.polyOutcome })}</th>
            <th>Pyth${tip({ text: PA_TIPS.pythOutcome })}</th>
            <th class="num-col">Open${tip({ text: PA_TIPS.pythOpen })}</th>
            <th class="num-col">Close${tip({ text: PA_TIPS.pythClose })}</th>
            <th class="num-col">|move%|${tip({ text: PA_TIPS.absMove })}</th>
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

function tip({ text }: { readonly text: string }): string {
  return ` <span class="alea-info-tip" tabindex="0" data-tip="${escapeHtml({ value: text })}" aria-label="${escapeHtml({ value: text })}"></span>`;
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

const PA_TIPS = {
  bucketsDisagree:
    "Disagreements only, bucketed by the size of the Pyth open→close move that landed opposite Polymarket. Tiny moves = boundary noise; larger moves = potential proxy drift.",
  bucketsAll:
    "Every joined window, bucketed by Pyth move size. Compare against the disagreement histogram to see whether disagreements over-represent any move bucket.",
  asset: "Crypto asset.",
  windows: "Joined windows for this asset in this timeframe.",
  agreement:
    "Share of joined windows where Pyth open→close matched Polymarket's settled side.",
  disagreeTotal:
    "Windows where Pyth's directional read landed on the opposite side from Polymarket.",
  clearDisagree:
    "Disagreements whose Pyth move% is at or above the training threshold. Each one is a window where the proxy would have given training or live trading the wrong side.",
  belowClear:
    "Share of disagreements whose Pyth move% is below the training threshold. High share = disagreements are mostly noise the training pipeline already filters out.",
  disagreeMean: "Mean absolute Pyth move% across this group's disagreements.",
  disagreeMedian:
    "Median absolute Pyth move% across this group's disagreements.",
  disagreeP90:
    "90th-percentile absolute Pyth move% across this group's disagreements.",
  windowTime:
    "Window start time (UTC), aligned to the timeframe's bar boundary.",
  polyOutcome:
    "Polymarket's Chainlink-derived settled side (Up = settled flat-or-up, Down = settled below).",
  pythOutcome:
    "Pyth open→close direction for the same window (≥ open = Up, < open = Down).",
  pythOpen: "Pyth open for the window.",
  pythClose: "Pyth close for the window.",
  absMove: "Absolute Pyth move% for the bar (|close - open| / open * 100).",
} as const;
