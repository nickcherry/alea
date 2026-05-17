import type {
  BacktestDashboardCandidateRow,
  BacktestDashboardPayload,
} from "@alea/lib/backtest/dashboard/types";
import {
  aleaBrandMark,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import {
  escapeHtml,
  escapeJsonForHtml,
  formatDateTime,
  formatPercent,
  infoTip,
  winRateToneClass,
} from "@alea/lib/ui/aleaFormat";
import { renderTopNav } from "@alea/lib/ui/topNav";

const TABLE_LIMIT = 20;

export function renderBacktestHtml({
  payload,
  assets,
}: {
  readonly payload: BacktestDashboardPayload;
  readonly assets: {
    readonly stylesheets: readonly string[];
    readonly scripts: readonly string[];
  };
}): string {
  const payloadJson = escapeJsonForHtml({ value: JSON.stringify(payload) });
  const initialPeriod = payload.defaultPeriod;
  const initialSlice =
    payload.byPeriod[initialPeriod] ??
    payload.byPeriod[payload.supportedPeriods[0] ?? "5m"]!;
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alea &middot; Backtest</title>
  ${aleaDesignSystemHead({ stylesheets: assets.stylesheets })}
</head>
<body>
  <div class="alea-shell">
    <header class="alea-header">
      <div class="alea-brand-row">${aleaBrandMark()}</div>
      <h1 class="alea-title">Backtest</h1>
      <p class="alea-subtitle">generated ${formatDateTime({ ms: payload.generatedAtMs })}</p>
    </header>
    ${renderTopNav({ activeId: "backtest" })}
    <main class="alea-main">
      <div class="alea-page-controls">
        <div class="alea-pill-tabs" role="tablist" aria-label="Candle period">
          ${payload.supportedPeriods
            .map(
              (period) =>
                `<button class="alea-pill-tab is-prominent backtest-period-tab" role="tab" data-period="${escapeHtml({ value: period })}" aria-selected="${period === initialPeriod ? "true" : "false"}">${escapeHtml({ value: period })}</button>`,
            )
            .join("\n          ")}
        </div>
      </div>

      <section class="backtest-section">
        <div class="alea-section-rule"><h2>Candidates</h2></div>
        <div class="alea-table-wrap">
          <table class="alea-table backtest-table">
            <thead id="backtest-head">
              ${renderTableHead({ quarters: initialSlice.quarters })}
            </thead>
            <tbody id="backtest-body">
              ${renderRows({ rows: initialSlice.rows, quarters: initialSlice.quarters })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </div>
  <script id="backtest-payload" type="application/json">${payloadJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>`;
}

function renderTableHead({
  quarters,
}: {
  readonly quarters: readonly string[];
}): string {
  return `<tr>
    <th>Filter${infoTip({ text: "Filter name and version. Rows are sorted by overall win rate for the active period." })}</th>
    <th>Config${infoTip({ text: "Exact configuration values evaluated for this candidate." })}</th>
    <th class="num-col">WR${infoTip({ text: "Overall wins divided by non-neutral decisions across all traded assets." })}</th>
    <th class="num-col">Decisions${infoTip({ text: "Non-neutral historical decisions stored in the quarterly blobs." })}</th>
    ${quarters.map((quarter) => `<th class="num-col quarter-col">${escapeHtml({ value: quarter })}</th>`).join("")}
  </tr>`;
}

function renderRows({
  rows,
  quarters,
}: {
  readonly rows: readonly BacktestDashboardCandidateRow[];
  readonly quarters: readonly string[];
}): string {
  const shown = rows.slice(0, TABLE_LIMIT);
  if (shown.length === 0) {
    return `<tr><td colspan="${4 + quarters.length}"><span class="alea-muted">No backtest rows yet.</span></td></tr>`;
  }
  return shown
    .map((row) => {
      const wr =
        row.winRate === null
          ? '<span class="alea-muted">—</span>'
          : formatPercent({ value: row.winRate });
      const quarterByLabel = new Map(row.quarters.map((q) => [q.label, q]));
      return `<tr>
        <td>
          <div class="backtest-filter-name">${escapeHtml({ value: row.filterName })} <span class="alea-muted">v${row.filterVersion}</span></div>
        </td>
        <td class="backtest-config-cell">
          <div class="backtest-config">${escapeHtml({ value: formatConfig(row.config) })}</div>
        </td>
        <td class="num-col alea-mono${winRateToneClass({ value: row.winRate })}">${wr}</td>
        <td class="num-col alea-mono">${row.decisionCount.toLocaleString()}</td>
        ${quarters
          .map((quarter) => renderQuarterCell(quarterByLabel.get(quarter)))
          .join("")}
      </tr>`;
    })
    .join("");
}

function renderQuarterCell(
  cell: BacktestDashboardCandidateRow["quarters"][number] | undefined,
): string {
  if (cell === undefined || cell.winRate === null) {
    return '<td class="num-col alea-muted">—</td>';
  }
  return `<td class="num-col alea-mono${winRateToneClass({ value: cell.winRate })}">${formatPercent({ value: cell.winRate })}<span class="backtest-cell-count">${cell.decisionCount.toLocaleString()}</span></td>`;
}

function formatConfig(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return String(value);
  }
  return JSON.stringify(value);
}
