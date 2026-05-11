import type { TradingPerformancePayload } from "@alea/lib/trading/performance/types";
import {
  aleaBrandMark,
  aleaChartTokens,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import {
  escapeHtml,
  escapeJsonForHtml,
  formatDateTime,
} from "@alea/lib/ui/aleaFormat";
import { renderTopNav } from "@alea/lib/ui/topNav";

/**
/**
 * Cap on the number of rows the Recent Trades table renders. The chart
 * still draws every market so lifetime performance shape is intact;
 * the table only shows the most recent slice so the page stays
 * scannable. Markets are pre-sorted newest-first by
 * `buildTradingPerformancePayload`, so `.slice(0, N)` grabs the
 * latest N.
 */
const RECENT_TRADES_LIMIT = 20;

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
  const subtitle = `generated ${formatDateTime({ ms: payload.generatedAtMs })}`;
  const visibleMarkets = payload.markets.slice(0, RECENT_TRADES_LIMIT);
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
          sub: `${payload.summary.marketCount.toLocaleString()} markets`,
        })}
        ${renderMetric({
          label: "Total Fees",
          value: formatUnsignedUsd({ value: payload.summary.totalFeesUsd }),
          tone: "negative",
          sub: `${formatUnsignedUsd({ value: payload.summary.makerRebateUsd })} rebates`,
        })}
        ${renderMetric({
          label: "Win / Loss",
          value: `${payload.summary.winningMarketCount.toLocaleString()} / ${payload.summary.losingMarketCount.toLocaleString()}`,
          sub: `${payload.summary.openPositionCount.toLocaleString()} open · ${payload.summary.flatMarketCount.toLocaleString()} flat`,
        })}
        ${renderMetric({
          label: "Open Positions",
          value: payload.summary.openPositionCount.toLocaleString(),
          sub: `${payload.summary.redeemablePositionCount.toLocaleString()} redeemable`,
        })}
      </section>

      <section class="trading-section">
        <div class="alea-section-rule"><h2>Cumulative PnL</h2></div>
        <div class="chart-frame">
          <div id="pnl-chart" class="chart-host"></div>
          <div id="pnl-empty" class="chart-empty">No positions to chart yet.</div>
          <div id="pnl-tooltip" class="alea-tooltip"></div>
        </div>
      </section>

      <section class="trading-section">
        <div class="alea-section-rule"><h2>Recent Trades</h2></div>
        <div class="alea-table-wrap">
          <table class="alea-table trading-performance-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th class="market-col">Market</th>
                <th>Role</th>
                <th>Fees</th>
                <th>Invested</th>
                <th>PnL</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${visibleMarkets.map(renderMarketRow).join("")}</tbody>
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

function renderMarketRow(
  row: TradingPerformancePayload["markets"][number],
): string {
  const pnlClass =
    row.pnlUsd > 0
      ? " alea-num-positive"
      : row.pnlUsd < 0
        ? " alea-num-negative"
        : "";
  return `
    <tr>
      <td><span class="symbol-pill">${escapeHtml({ value: row.symbol })}</span></td>
      <td class="market-col">
        <div class="trade-market">
          <span class="trade-question">${escapeHtml({ value: row.title })}</span>
          <span class="trade-sub">${escapeHtml({ value: row.slug ?? shortId({ value: row.conditionId }) })}</span>
        </div>
      </td>
      <td>${renderRolePill({ role: row.traderRole })}</td>
      <td class="alea-mono">${formatUnsignedUsd({ value: row.feeUsd })}</td>
      <td class="alea-mono">${formatUnsignedUsd({ value: row.investedUsd })}</td>
      <td class="alea-mono${pnlClass}">${formatSignedUsd({ value: row.pnlUsd })}</td>
      <td><span class="result-pill ${row.result}">${row.result}</span></td>
    </tr>
  `;
}

function renderRolePill({
  role,
}: {
  readonly role: TradingPerformancePayload["markets"][number]["traderRole"];
}): string {
  if (role === null) {
    return '<span class="alea-muted">—</span>';
  }
  const label =
    role === "maker" ? "Maker" : role === "taker" ? "Taker" : "Mixed";
  return `<span class="role-pill role-${role}">${label}</span>`;
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

function shortId({ value }: { readonly value: string }): string {
  if (value.length <= 14) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}


