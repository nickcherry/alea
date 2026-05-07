import type { TradingPerformancePayload } from "@alea/lib/trading/performance/types";
import {
  aleaBrandMark,
  aleaChartTokens,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import { renderTopNav } from "@alea/lib/ui/topNav";

export function renderTradingPerformanceHtml({
  payload,
  assets,
}: {
  readonly payload: TradingPerformancePayload;
  readonly assets: {
    readonly stylesheets: readonly string[];
    readonly scripts: readonly string[];
  };
}): string {
  const subtitle = [
    `wallet ${shortAddress({ value: payload.walletAddress })}`,
    `generated ${formatDateTime({ ms: payload.generatedAtMs })}`,
    `${payload.summary.positionCount.toLocaleString()} positions`,
  ].join('<span class="sep">&middot;</span>');
  const payloadJson = escapeJsonForHtml({ value: JSON.stringify(payload) });
  const chartTokensJson = escapeJsonForHtml({
    value: JSON.stringify(aleaChartTokens),
  });

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alea &middot; Polymarket Trading Performance</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.min.css" />
  <script src="https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.iife.min.js" charset="utf-8"></script>
  ${aleaDesignSystemHead({ stylesheets: assets.stylesheets })}
</head>
<body>
  <div class="alea-shell">
    <header class="alea-header">
      <div class="alea-brand-row">${aleaBrandMark()}</div>
      <h1 class="alea-title">Polymarket Trading Performance</h1>
      <p class="alea-subtitle">${subtitle}</p>
    </header>
    ${renderTopNav({ activeId: "live" })}
    <main class="alea-main">
      <section class="alea-summary-grid cols-4">
        ${renderMetric({
          label: "Lifetime PnL",
          value: formatSignedUsd({ value: payload.summary.lifetimePnlUsd }),
          tone: toneForNumber({ value: payload.summary.lifetimePnlUsd }),
          sub: `mark-to-market across ${payload.summary.positionCount.toLocaleString()} positions`,
        })}
        ${renderMetric({
          label: "Current Value",
          value: formatUnsignedUsd({ value: payload.summary.currentValueUsd }),
          sub: `${formatUnsignedUsd({ value: payload.summary.totalInvestedUsd })} invested lifetime`,
        })}
        ${renderMetric({
          label: "Win / Loss",
          value: `${payload.summary.winningPositionCount.toLocaleString()} / ${payload.summary.losingPositionCount.toLocaleString()}`,
          sub: `${payload.summary.openPositionCount.toLocaleString()} open · ${payload.summary.flatPositionCount.toLocaleString()} flat`,
        })}
        ${renderMetric({
          label: "Open Positions",
          value: payload.summary.openPositionCount.toLocaleString(),
          sub: `${payload.summary.redeemablePositionCount.toLocaleString()} redeemable`,
        })}
      </section>

      <section class="alea-card with-corners">
        <div class="alea-card-header">
          <h2 class="alea-card-title">Cumulative PnL</h2>
          <p class="alea-card-meta">Each step = one position's mark-to-market PnL, ordered by settlement date.</p>
        </div>
        <div class="chart-frame">
          <div id="pnl-chart" class="chart-host"></div>
          <div id="pnl-empty" class="chart-empty">No positions to chart yet.</div>
          <div id="pnl-tooltip" class="alea-tooltip"></div>
        </div>
        <p class="source-line">Source: ${escapeHtml({ value: payload.source.positions })}.</p>
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Positions</h2></div>
        <div class="alea-table-wrap">
          <table class="alea-table trading-performance-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Market</th>
                <th>Outcome</th>
                <th>Size</th>
                <th>Avg Price</th>
                <th>Cur Price</th>
                <th>Invested</th>
                <th>Current</th>
                <th>PnL</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${payload.positions.map(renderPositionRow).join("")}</tbody>
          </table>
        </div>
      </section>
    </main>
  </div>
  <script id="performance-payload" type="application/json">${payloadJson}</script>
  <script id="performance-tokens" type="application/json">${chartTokensJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>`;
}

function renderMetric({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly tone?: "positive" | "negative" | "neutral";
}): string {
  const toneClass = tone === "neutral" ? "" : ` ${tone}`;
  return `
    <div class="alea-metric">
      <p class="alea-metric-label">${escapeHtml({ value: label })}</p>
      <p class="alea-metric-value${toneClass}">${escapeHtml({ value })}</p>
      <p class="alea-metric-sub">${escapeHtml({ value: sub })}</p>
    </div>
  `;
}

function renderPositionRow(
  row: TradingPerformancePayload["positions"][number],
): string {
  const pnlClass =
    row.cashPnlUsd > 0
      ? " alea-num-positive"
      : row.cashPnlUsd < 0
        ? " alea-num-negative"
        : "";
  return `
    <tr>
      <td><span class="symbol-pill">${escapeHtml({ value: row.symbol })}</span></td>
      <td>
        <div class="trade-market">
          <span class="trade-question">${escapeHtml({ value: row.title })}</span>
          <span class="trade-sub">${escapeHtml({ value: row.slug ?? shortId({ value: row.conditionId }) })}</span>
        </div>
      </td>
      <td>${escapeHtml({ value: row.outcome })}</td>
      <td class="alea-mono">${formatNumber({ value: row.size, maximumFractionDigits: 2 })}</td>
      <td class="alea-mono">${formatPrice({ value: row.avgPrice })}</td>
      <td class="alea-mono">${formatPrice({ value: row.currentPrice })}</td>
      <td class="alea-mono">${formatUnsignedUsd({ value: row.initialValueUsd })}</td>
      <td class="alea-mono">${formatUnsignedUsd({ value: row.currentValueUsd })}</td>
      <td class="alea-mono${pnlClass}">${formatSignedUsd({ value: row.cashPnlUsd })}</td>
      <td><span class="result-pill ${row.result}">${row.result}</span></td>
    </tr>
  `;
}

function formatDateTime({ ms }: { readonly ms: number }): string {
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

function formatSignedUsd({ value }: { readonly value: number }): string {
  if (value === 0) {
    return "$0.00";
  }
  const sign = value > 0 ? "+" : "-";
  return `${sign}${formatUnsignedUsd({ value: Math.abs(value) })}`;
}

function formatUnsignedUsd({ value }: { readonly value: number }): string {
  return `$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPrice({ value }: { readonly value: number }): string {
  return value.toFixed(3);
}

function formatNumber({
  value,
  maximumFractionDigits,
}: {
  readonly value: number;
  readonly maximumFractionDigits: number;
}): string {
  return value.toLocaleString("en-US", { maximumFractionDigits });
}

function toneForNumber({
  value,
}: {
  readonly value: number;
}): "positive" | "negative" | "neutral" {
  if (value > 0) {
    return "positive";
  }
  if (value < 0) {
    return "negative";
  }
  return "neutral";
}

function shortAddress({ value }: { readonly value: string }): string {
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function shortId({ value }: { readonly value: string }): string {
  if (value.length <= 14) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
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
