import type { TradingPerformancePayload } from "@alea/lib/trading/performance/types";
import {
  aleaBrandMark,
  aleaChartTokens,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import { renderTopNav } from "@alea/lib/ui/topNav";

/**
 * Cap on the number of rows the Markets table renders. The chart
 * still draws every market so lifetime performance shape is intact;
 * the table only shows the recent slice so the page stays fast and
 * scannable. Markets are pre-sorted newest-first by
 * `buildTradingPerformancePayload`, so a `.slice(0, N)` grabs the
 * latest N.
 */
const MARKETS_TABLE_LIMIT = 200;

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
  const visibleMarkets = payload.markets.slice(0, MARKETS_TABLE_LIMIT);
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
          sub: `realized + mark-to-market across ${payload.summary.marketCount.toLocaleString()} markets`,
          tip: TP_TIPS.lifetimePnl,
        })}
        ${renderMetric({
          label: "Total Fees",
          value: formatUnsignedUsd({ value: payload.summary.totalFeesUsd }),
          tone: "negative",
          sub: `${formatUnsignedUsd({ value: payload.summary.makerRebateUsd })} maker rebates earned`,
          tip: TP_TIPS.totalFees,
        })}
        ${renderMetric({
          label: "Win / Loss",
          value: `${payload.summary.winningMarketCount.toLocaleString()} / ${payload.summary.losingMarketCount.toLocaleString()}`,
          sub: `${payload.summary.openPositionCount.toLocaleString()} open · ${payload.summary.flatMarketCount.toLocaleString()} flat`,
          tip: TP_TIPS.winLoss,
        })}
        ${renderMetric({
          label: "Open Positions",
          value: payload.summary.openPositionCount.toLocaleString(),
          sub: `${payload.summary.redeemablePositionCount.toLocaleString()} redeemable`,
          tip: TP_TIPS.openPositions,
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
        <p class="source-line">Source: ${escapeHtml({ value: payload.source.activity })}; ${escapeHtml({ value: payload.source.positions })}.</p>
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Markets</h2></div>
        ${renderTableMeta({ shown: visibleMarkets.length, total: payload.markets.length })}
        <div class="alea-table-wrap">
          <table class="alea-table trading-performance-table">
            <thead>
              <tr>
                <th>Symbol${infoTip({ text: TP_TIPS.symbol })}</th>
                <th class="market-col">Market${infoTip({ text: TP_TIPS.market })}</th>
                <th>Role${infoTip({ text: TP_TIPS.role })}</th>
                <th>Fees${infoTip({ text: TP_TIPS.fees })}</th>
                <th>Invested${infoTip({ text: TP_TIPS.invested })}</th>
                <th>PnL${infoTip({ text: TP_TIPS.pnl })}</th>
                <th>Status${infoTip({ text: TP_TIPS.status })}</th>
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
  tip,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly tone?: "positive" | "negative" | "neutral";
  readonly tip?: string;
}): string {
  const toneClass = tone === "neutral" ? "" : ` ${tone}`;
  return `
    <div class="alea-metric">
      <p class="alea-metric-label">${escapeHtml({ value: label })}${tip === undefined ? "" : infoTip({ text: tip })}</p>
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

function renderTableMeta({
  shown,
  total,
}: {
  readonly shown: number;
  readonly total: number;
}): string {
  if (total <= shown) {
    return "";
  }
  return `<p class="markets-table-meta">Below are the most recent ${shown.toLocaleString()} of ${total.toLocaleString()} trades.</p>`;
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

const TP_TIPS = {
  lifetimePnl:
    "Net value across all Polymarket markets: realized results plus current open value.",
  totalFees: "Total trading fees paid, with maker rebates shown underneath.",
  winLoss: "Markets currently profitable vs losing.",
  openPositions: "Markets where we still hold unresolved shares.",
  symbol: "Short market ticker, usually the asset.",
  market: "The Polymarket question or slug this row belongs to.",
  role: "How our fills happened: maker, taker, or mixed.",
  fees: "Estimated trading fees for this market.",
  invested: "Total dollars put into positions on this market.",
  pnl: "Profit or loss for this market, including current value if still open.",
  status: "Current settlement or position state.",
};

function infoTip({ text }: { readonly text: string }): string {
  return ` <span class="alea-info-tip" tabindex="0" data-tip="${escapeHtml({
    value: text,
  })}" aria-label="${escapeHtml({ value: text })}"></span>`;
}
