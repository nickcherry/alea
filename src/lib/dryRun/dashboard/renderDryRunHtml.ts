import type {
  DryRunDashboardPayload,
  DryRunDashboardRecentRow,
} from "@alea/lib/dryRun/dashboard/types";
import {
  aleaBrandMark,
  aleaChartTokens,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import {
  escapeHtml,
  escapeJsonForHtml,
  formatDateTime,
  formatMarketRegime as formatMarketRegimeRaw,
  formatPercent,
  infoTip,
  winRateToneClass,
} from "@alea/lib/ui/aleaFormat";
import { renderTopNav } from "@alea/lib/ui/topNav";

function formatMarketRegime(value: string | null): string {
  if (value === null) {
    return "—";
  }
  return formatMarketRegimeRaw({ value });
}

const RECENT_TABLE_LIMIT = 50;

export function renderDryRunHtml({
  payload,
  assets,
}: {
  readonly payload: DryRunDashboardPayload;
  readonly assets: {
    readonly stylesheets: readonly string[];
    readonly scripts: readonly string[];
  };
}): string {
  const subtitle = `generated ${formatDateTime({ ms: payload.generatedAtMs })}`;
  const payloadJson = escapeJsonForHtml({ value: JSON.stringify(payload) });
  const chartTokensJson = escapeJsonForHtml({
    value: JSON.stringify(aleaChartTokens),
  });

  const initialPeriod = payload.decisionConfig.period;
  const initialSlice =
    payload.byPeriod[initialPeriod] ??
    payload.byPeriod[payload.decisionConfig.supportedPeriods[0] ?? "5m"]!;
  const recentRows = payload.recent
    .filter((r) => r.period === initialPeriod)
    .slice(0, RECENT_TABLE_LIMIT);

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alea &middot; Dry Run</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.min.css" />
  <script src="https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.iife.min.js" charset="utf-8"></script>
  ${aleaDesignSystemHead({ stylesheets: assets.stylesheets })}
</head>
<body>
  <div class="alea-shell">
    <header class="alea-header">
      <div class="alea-brand-row">${aleaBrandMark()}</div>
      <h1 class="alea-title">Dry Run</h1>
      <p class="alea-subtitle">${subtitle}</p>
    </header>
    ${renderTopNav({ activeId: "dryrun" })}
    <main class="alea-main">
      <div class="alea-page-controls">
        <div class="alea-pill-tabs" role="tablist" aria-label="Candle period">
          ${payload.decisionConfig.supportedPeriods
            .map(
              (p) =>
                `<button class="alea-pill-tab is-prominent dry-run-period-tab" role="tab" data-period="${escapeHtml({ value: p })}" aria-selected="${p === initialPeriod ? "true" : "false"}">${escapeHtml({ value: p })}</button>`,
            )
            .join("\n          ")}
        </div>
      </div>

      <section class="dry-run-section">
        <details class="alea-config-section">
          <summary class="alea-config-summary alea-section-rule"><h2>Trade Decision Config</h2></summary>
          <div class="alea-config-grid">
            ${renderConfigGroup({
              title: "Timing",
              items: [
                {
                  label: "Decision Lead",
                  value: `${(payload.decisionConfig.leadTimeMs / 1000).toLocaleString()}s`,
                  tip: "How long before the target candle's open the committee runs.",
                },
                {
                  label: "Hydrated Bars",
                  value: payload.decisionConfig.hydratedBars.toLocaleString(),
                  tip: "Per-asset history loaded at startup so filters can compute on bar one.",
                },
              ],
            })}
            ${renderConfigGroup({
              title: "Voting",
              items: [
                {
                  label: "Max Votes / Filter",
                  value: `<= ${payload.decisionConfig.maxVotesPerFilter.toLocaleString()}`,
                  tip: "Cap on votes any single filter family can contribute. The highest-WR engaged config wins.",
                },
                {
                  label: "Min Votes",
                  value: `>= ${payload.decisionConfig.minVotesToTrade.toLocaleString()}`,
                  tip: "Minimum votes (after filter-level collapse) required before a decision is taken.",
                },
                {
                  label: "Consensus",
                  value: `>= ${formatPercent({ value: payload.decisionConfig.minConsensusFraction })}`,
                  tip: "Fraction of votes that must agree on a side. Ties still abstain.",
                },
                {
                  label: "Filter Tie Break",
                  value: formatFilterTieBreak({
                    value: payload.decisionConfig.filterTieBreak,
                  }),
                  tip: "Order used to pick a winner when multiple configs in the same filter engage.",
                },
              ],
            })}
            ${renderConfigGroup({
              title: "Order Simulation",
              items: [
                {
                  label: "Placement Delay",
                  value: `${(payload.decisionConfig.orderPlacementDelayMs / 1000).toLocaleString()}s`,
                  tip: "Wait after the committee decision before placing the simulated order.",
                },
                {
                  label: "Limit Price",
                  value: formatOrderLimitPolicy({
                    value: payload.decisionConfig.orderLimitPricePolicy,
                  }),
                  tip: "How the simulated limit-buy price is chosen.",
                },
                {
                  label: "50c Window",
                  value: `±${payload.decisionConfig.orderPriceWindowCents.toLocaleString()}c`,
                  tip: "Acceptable distance from 50c on the simulated limit price.",
                },
                {
                  label: "Quote Max Age",
                  value: formatQuoteAgeLimit({
                    value: payload.decisionConfig.orderMaxQuoteAgeMs,
                  }),
                  tip: "Book/BBO age cutoff used to price the simulated order.",
                },
                {
                  label: "Discovery Lead",
                  value: `${(payload.decisionConfig.marketDiscoveryLeadMs / 1000).toLocaleString()}s`,
                  tip: "Lead time used to pre-discover the current/next Polymarket markets.",
                },
              ],
            })}
          </div>
        </details>
      </section>

      <section class="dry-run-section">
        <div class="alea-section-rule"><h2>Cumulative Win Rate</h2></div>
        <div class="dry-run-chart-frame">
          <div id="dry-run-chart" class="dry-run-chart-host"></div>
          <div id="dry-run-chart-empty" class="dry-run-empty"${initialSlice.cumulative.length === 0 ? "" : ' style="display:none"'}>
            No settled decisions yet.
          </div>
          <div id="dry-run-tooltip" class="alea-tooltip"></div>
        </div>
      </section>

      <section class="dry-run-section">
        <div class="alea-section-rule"><h2>Per Market Regime</h2></div>
        <div class="alea-table-wrap">
          <table class="alea-table dry-run-table">
            <thead>
              <tr>
                <th>Regime</th>
                <th class="num-col">Calls</th>
                <th class="num-col">Win Rate</th>
                <th class="num-col">U / D</th>
              </tr>
            </thead>
            <tbody id="dry-run-regime-body">
              ${renderRegimeRows({ rows: initialSlice.perRegime })}
            </tbody>
          </table>
        </div>
      </section>

      <section class="dry-run-section">
        <div class="alea-section-rule"><h2>Per Asset</h2></div>
        <div class="alea-table-wrap">
          <table class="alea-table dry-run-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th class="num-col">Calls</th>
                <th class="num-col">Win Rate</th>
                <th class="num-col">U / D</th>
              </tr>
            </thead>
            <tbody id="dry-run-asset-body">
              ${renderAssetRows({ rows: initialSlice.perAsset })}
            </tbody>
          </table>
        </div>
      </section>

      <section class="dry-run-section">
        <div class="alea-section-rule"><h2>Recent Decisions</h2></div>
        <p class="dry-run-recent-meta" id="dry-run-recent-meta">${recentMetaLabel({ shown: recentRows.length, totalForPeriod: payload.recent.filter((r) => r.period === initialPeriod).length })}</p>
        <div class="alea-table-wrap">
          <table class="alea-table dry-run-recent-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Asset</th>
                <th>Prediction</th>
                <th>Market Regime</th>
                <th class="num-col">Synth Open</th>
                <th class="num-col">Actual Close</th>
                <th class="num-col">Move</th>
                <th>Order</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody id="dry-run-recent-body">
              ${renderRecentRows({ rows: recentRows })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </div>
  <script id="dry-run-payload" type="application/json">${payloadJson}</script>
  <script id="dry-run-tokens" type="application/json">${chartTokensJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>`;
}

function renderRegimeRows({
  rows,
}: {
  readonly rows: DryRunDashboardPayload["byPeriod"][string]["perRegime"];
}): string {
  if (rows.length === 0) {
    return `<tr><td colspan="4"><span class="alea-muted">No regime-tagged decisions yet.</span></td></tr>`;
  }
  return rows
    .map((r) => {
      const wrStr =
        r.winRate === null
          ? '<span class="alea-muted">—</span>'
          : formatPercent({ value: r.winRate });
      const cls = winRateToneClass({ value: r.winRate });
      return `
        <tr>
          <td><span class="asset-pill">${escapeHtml({ value: formatMarketRegime(r.marketRegime) })}</span></td>
          <td class="num-col alea-mono">${r.calls.toLocaleString()}</td>
          <td class="num-col alea-mono${cls}">${wrStr}</td>
          <td class="num-col alea-mono">${renderDirectionSplit({ up: r.upSettled, down: r.downSettled })}</td>
        </tr>`;
    })
    .join("");
}

function renderAssetRows({
  rows,
}: {
  readonly rows: DryRunDashboardPayload["byPeriod"][string]["perAsset"];
}): string {
  if (rows.length === 0) {
    return `<tr><td colspan="4"><span class="alea-muted">No decisions yet for this period.</span></td></tr>`;
  }
  return rows
    .map((r) => {
      const wrStr =
        r.winRate === null
          ? '<span class="alea-muted">—</span>'
          : formatPercent({ value: r.winRate });
      const cls = winRateToneClass({ value: r.winRate });
      return `
        <tr>
          <td><span class="asset-pill">${escapeHtml({ value: r.asset })}</span></td>
          <td class="num-col alea-mono">${r.settled.toLocaleString()}</td>
          <td class="num-col alea-mono${cls}">${wrStr}</td>
          <td class="num-col alea-mono">${renderDirectionSplit({ up: r.upSettled, down: r.downSettled })}</td>
        </tr>`;
    })
    .join("");
}

function recentMetaLabel({
  shown,
  totalForPeriod,
}: {
  readonly shown: number;
  readonly totalForPeriod: number;
}): string {
  return `latest ${shown.toLocaleString()} of ${totalForPeriod.toLocaleString()}`;
}

function renderRecentRows({
  rows,
}: {
  readonly rows: readonly DryRunDashboardRecentRow[];
}): string {
  if (rows.length === 0) {
    return `<tr><td colspan="9"><span class="alea-muted">No decisions yet for this period.</span></td></tr>`;
  }
  return rows.map(renderRecentRow).join("");
}

function renderRecentRow(row: DryRunDashboardRecentRow): string {
  const ts = new Date(row.tsMs).toISOString().slice(0, 16).replace("T", " ");
  const tag =
    row.prediction === "u"
      ? '<span class="alea-num-positive">UP</span>'
      : '<span class="alea-num-negative">DOWN</span>';
  const close =
    row.actualClose === null
      ? '<span class="alea-muted">pending</span>'
      : row.actualClose.toFixed(2);
  let outcome: string;
  if (row.won === null) {
    outcome = '<span class="alea-muted">—</span>';
  } else if (row.won === 1) {
    outcome = '<span class="dry-run-outcome win">WIN</span>';
  } else {
    outcome = '<span class="dry-run-outcome loss">LOSS</span>';
  }
  const regimeCell =
    row.marketRegime === null
      ? '<span class="alea-muted">—</span>'
      : `<span class="asset-pill">${escapeHtml({ value: formatMarketRegime(row.marketRegime) })}</span>`;
  const moveCell = renderMoveCell({
    synthOpen: row.synthOpen,
    actualClose: row.actualClose,
  });
  return `
    <tr>
      <td class="alea-mono">${escapeHtml({ value: ts })}</td>
      <td><span class="asset-pill">${escapeHtml({ value: row.asset })}</span></td>
      <td>${tag}</td>
      <td>${regimeCell}</td>
      <td class="num-col alea-mono">${row.synthOpen.toFixed(2)}</td>
      <td class="num-col alea-mono">${close}</td>
      <td class="num-col">${moveCell}</td>
      <td>${renderOrderCell(row)}</td>
      <td>${outcome}</td>
    </tr>
  `;
}

function renderOrderCell(row: DryRunDashboardRecentRow): string {
  const status = row.orderStatus;
  if (status === "filled") {
    return `<span class="dry-run-order filled">FILLED</span>${renderOrderPriceBits(
      {
        limitPrice: row.orderLimitPrice,
        fillPrice: row.orderFillPrice,
        confidence: row.orderConfidence,
        decisionDurationMs: row.decisionDurationMs,
        orderFillLatencyMs: row.orderFillLatencyMs,
      },
    )}`;
  }
  if (status === "unfilled") {
    return `<span class="dry-run-order unfilled">UNFILLED</span>${renderOrderPriceBits(
      {
        limitPrice: row.orderLimitPrice,
        fillPrice: row.orderFillPrice,
        confidence: row.orderConfidence,
        decisionDurationMs: row.decisionDurationMs,
        orderFillLatencyMs: row.orderFillLatencyMs,
      },
    )}`;
  }
  if (status === "placed" || status === "pending_placement") {
    return `<span class="dry-run-order pending">${escapeHtml({ value: formatOrderStatus(status) })}</span>${renderOrderPriceBits(
      {
        limitPrice: row.orderLimitPrice,
        fillPrice: row.orderFillPrice,
        confidence: row.orderConfidence,
        decisionDurationMs: row.decisionDurationMs,
        orderFillLatencyMs: row.orderFillLatencyMs,
      },
    )}`;
  }
  if (status.startsWith("skipped")) {
    return `<span class="dry-run-order skipped">${escapeHtml({ value: formatOrderStatus(status) })}</span>${renderOrderPriceBits(
      {
        limitPrice: row.orderLimitPrice,
        fillPrice: row.orderFillPrice,
        confidence: row.orderConfidence,
        decisionDurationMs: row.decisionDurationMs,
        orderFillLatencyMs: row.orderFillLatencyMs,
      },
    )}`;
  }
  return `<span class="alea-muted">${escapeHtml({ value: formatOrderStatus(status) })}</span>`;
}

function renderOrderPriceBits({
  limitPrice,
  fillPrice,
  confidence,
  decisionDurationMs,
  orderFillLatencyMs,
}: {
  readonly limitPrice: number | null;
  readonly fillPrice: number | null;
  readonly confidence: number | null;
  readonly decisionDurationMs: number | null;
  readonly orderFillLatencyMs: number | null;
}): string {
  const bits: string[] = [];
  if (limitPrice !== null) {
    bits.push(`limit ${formatCents({ value: limitPrice })}`);
  }
  if (fillPrice !== null) {
    bits.push(`fill ${formatCents({ value: fillPrice })}`);
  }
  if (confidence !== null) {
    bits.push(`conf ${formatCents({ value: confidence })}`);
  }
  if (decisionDurationMs !== null) {
    bits.push(`dec ${formatMs({ value: decisionDurationMs })}`);
  }
  if (orderFillLatencyMs !== null) {
    bits.push(`fill wait ${formatMs({ value: orderFillLatencyMs })}`);
  }
  return bits.length === 0
    ? ""
    : `<span class="dry-run-order-detail">${escapeHtml({ value: bits.join(" · ") })}</span>`;
}

function formatOrderLimitPolicy({ value }: { readonly value: string }): string {
  switch (value) {
    case "buy_predicted_side_one_tick_below_best_ask_or_50c_if_missing":
      return "one tick below ask, 50c fallback";
    case "buy_predicted_side_one_tick_below_best_ask":
      return "one tick below ask";
    default:
      return value.replaceAll("_", " ");
  }
}

function formatOrderStatus(status: string): string {
  switch (status) {
    case "pending_placement":
      return "pending";
    case "skipped_no_market":
      return "skip no market";
    case "skipped_no_price":
      return "skip no price";
    case "skipped_price_window":
      return "skip price";
    case "skipped_confidence":
      return "skip edge";
    default:
      return status.replaceAll("_", " ");
  }
}

function formatCents({ value }: { readonly value: number }): string {
  return `${(value * 100).toFixed(1)}c`;
}

function formatMs({ value }: { readonly value: number }): string {
  return `${Math.max(0, Math.round(value)).toLocaleString()}ms`;
}

function formatQuoteAgeLimit({ value }: { readonly value: number }): string {
  if (value >= Number.MAX_SAFE_INTEGER) {
    return "no age cutoff";
  }
  return `${(value / 1000).toLocaleString()}s`;
}

/**
 * Open-to-close percent move with sign. Green for up moves, red for
 * down. `—` while the bar is still pending.
 */
function renderMoveCell({
  synthOpen,
  actualClose,
}: {
  readonly synthOpen: number;
  readonly actualClose: number | null;
}): string {
  if (actualClose === null || synthOpen === 0) {
    return '<span class="alea-muted">—</span>';
  }
  const pct = ((actualClose - synthOpen) / synthOpen) * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "" : "";
  const cls =
    pct > 0
      ? " alea-num-positive"
      : pct < 0
        ? " alea-num-negative"
        : " alea-muted";
  return `<span class="alea-mono${cls}">${sign}${pct.toFixed(2)}%</span>`;
}

/**
 * "↑n / ↓n" badge — tone-tinted on the side that dominates so the eye
 * spots a directional bias without reading both numbers.
 */
function renderDirectionSplit({
  up,
  down,
}: {
  readonly up: number;
  readonly down: number;
}): string {
  if (up + down === 0) {
    return '<span class="alea-muted">—</span>';
  }
  const upCls = up >= down ? "" : " alea-muted";
  const downCls = down > up ? "" : " alea-muted";
  return `<span class="alea-mono"><span class="${upCls.trim()}">↑${up.toLocaleString()}</span> / <span class="${downCls.trim()}">↓${down.toLocaleString()}</span></span>`;
}

type ConfigItem = {
  readonly label: string;
  readonly value: string;
  readonly tip: string;
};

function renderConfigGroup({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly ConfigItem[];
}): string {
  return `
    <div class="alea-config-group">
      <h3 class="alea-config-group-title">${escapeHtml({ value: title })}</h3>
      <div class="alea-config-list">
        ${items.map(renderConfigItem).join("")}
      </div>
    </div>`;
}

function renderConfigItem(item: ConfigItem): string {
  const tipHtml = item.tip === "" ? "" : infoTip({ text: item.tip });
  return `
    <div class="alea-config-item">
      <span class="alea-config-label">${escapeHtml({ value: item.label })}${tipHtml}</span>
      <span class="alea-config-value">${escapeHtml({ value: item.value })}</span>
    </div>`;
}

function formatFilterTieBreak({ value }: { readonly value: string }): string {
  if (value === "highest_win_rate_then_engagements_then_rank") {
    return "win rate > engagements > rank";
  }
  return value;
}
