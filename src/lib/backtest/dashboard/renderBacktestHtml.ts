import type {
  BacktestDashboardAssetRow,
  BacktestDashboardCandidateRow,
  BacktestDashboardPayload,
  BacktestDashboardPeriodRow,
} from "@alea/lib/backtest/dashboard/types";
import type { FilterFamily } from "@alea/lib/filters/types";
import {
  aleaBrandMark,
  aleaChartTokens,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import {
  escapeHtml,
  escapeJsonForHtml,
  familyLabel,
  formatDateTime,
  formatPercent,
  winRateToneClass,
} from "@alea/lib/ui/aleaFormat";
import { renderTopNav } from "@alea/lib/ui/topNav";

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
  const subtitle = `generated ${formatDateTime({ ms: payload.generatedAtMs })}`;
  const payloadJson = escapeJsonForHtml({ value: JSON.stringify(payload) });
  const chartTokensJson = escapeJsonForHtml({
    value: JSON.stringify(aleaChartTokens),
  });
  const initialPeriod = payload.supportedPeriods[0] ?? "5m";

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alea &middot; Backtest</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.min.css" />
  <script src="https://cdn.jsdelivr.net/npm/uplot@1.6.30/dist/uPlot.iife.min.js" charset="utf-8"></script>
  ${aleaDesignSystemHead({ stylesheets: assets.stylesheets })}
</head>
<body>
  <div class="alea-shell">
    <header class="alea-header">
      <div class="alea-brand-row">${aleaBrandMark()}</div>
      <h1 class="alea-title">Backtest</h1>
      <p class="alea-subtitle">${subtitle}</p>
    </header>
    ${renderTopNav({ activeId: "backtest" })}
    <main class="alea-main backtest-main">
      ${renderPeriodControls({ periods: payload.supportedPeriods, initialPeriod })}
      ${renderPnlChart()}
      ${renderProfile({ payload, initialPeriod })}
      ${renderPeriodTable({ rows: payload.byPeriod, initialPeriod })}
      ${renderAssetTable({ rows: payload.byAsset, initialPeriod })}
      ${renderTopCandidateTable({ rows: payload.topCandidates, initialPeriod })}
    </main>
  </div>
  <script id="backtest-payload" type="application/json">${payloadJson}</script>
  <script id="backtest-tokens" type="application/json">${chartTokensJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>`;
}

function renderPeriodControls({
  periods,
  initialPeriod,
}: {
  readonly periods: readonly string[];
  readonly initialPeriod: string;
}): string {
  return `<div class="alea-page-controls backtest-controls">
    <div class="alea-pill-tabs" role="tablist" aria-label="Candle period">
      ${periods
        .map(
          (period) =>
            `<button class="alea-pill-tab is-prominent backtest-period-tab" role="tab" data-period="${escapeHtml({ value: period })}" aria-selected="${period === initialPeriod ? "true" : "false"}">${escapeHtml({ value: period })}</button>`,
        )
        .join("")}
    </div>
  </div>`;
}

function renderPnlChart(): string {
  return `<section class="alea-panel backtest-panel backtest-chart-panel">
    <div class="alea-section-rule"><h2>Cumulative PnL</h2></div>
    <div class="backtest-chart-frame">
      <div id="backtest-pnl-chart" class="backtest-chart-host"></div>
      <div id="backtest-pnl-empty" class="backtest-chart-empty">No chart data.</div>
      <div id="backtest-pnl-tooltip" class="alea-tooltip"></div>
    </div>
  </section>`;
}

function renderProfile({
  payload,
  initialPeriod,
}: {
  readonly payload: BacktestDashboardPayload;
  readonly initialPeriod: string;
}): string {
  const periodRow =
    payload.byPeriod.find((row) => row.period === initialPeriod) ?? null;
  return `<section class="alea-panel backtest-profile">
    <div class="alea-section-rule"><h2>Profile</h2></div>
    <div class="backtest-profile-grid">
      ${profileItem({
        id: "backtest-profile-period",
        label: "Period",
        value: initialPeriod,
      })}
      ${profileItem({
        id: "backtest-profile-coverage",
        label: "Coverage",
        value:
          periodRow === null
            ? "0 / 0"
            : formatCoverage({
                runCount: periodRow.runCount,
                expectedRunCount: periodRow.expectedRunCount,
              }),
      })}
      ${profileItem({
        id: "backtest-profile-win-rate",
        label: "Win rate",
        value: formatPercentOrDash({ value: periodRow?.winRate ?? null }),
      })}
      ${profileItem({
        id: "backtest-profile-engagements",
        label: "Engagements",
        value: (periodRow?.nEngagements ?? 0).toLocaleString(),
      })}
      ${profileItem({
        id: "backtest-profile-latest",
        label: "Latest computed",
        value: formatDateTimeOrDash({ ms: periodRow?.computedAtMaxMs ?? null }),
      })}
      ${profileItem({ label: "Training profile", value: payload.trainingProfileId })}
      ${profileItem({ label: "Assets", value: payload.assets.join(", ") })}
      ${profileItem({
        id: "backtest-profile-candle-range",
        label: "Candle range",
        value: `${formatDateOrDash({ ms: periodRow?.rangeFirstMs ?? null })} to ${formatDateOrDash({ ms: periodRow?.rangeLastMs ?? null })}`,
      })}
    </div>
  </section>`;
}

function renderPeriodTable({
  rows,
  initialPeriod,
}: {
  readonly rows: readonly BacktestDashboardPeriodRow[];
  readonly initialPeriod: string;
}): string {
  return `<section class="alea-panel backtest-panel">
    <div class="alea-section-rule"><h2>Periods</h2></div>
    <div class="alea-table-wrap">
      <table class="alea-table backtest-table">
        <thead>
          <tr>
            <th>Period</th>
            <th>Coverage</th>
            <th>Assets</th>
            <th>Engagements</th>
            <th>WR</th>
            <th>Bars</th>
            <th>Latest</th>
            <th>Range</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => renderPeriodRow({ row, initialPeriod })).join("")}
        </tbody>
      </table>
    </div>
  </section>`;
}

function renderPeriodRow({
  row,
  initialPeriod,
}: {
  readonly row: BacktestDashboardPeriodRow;
  readonly initialPeriod: string;
}): string {
  return `<tr data-backtest-period="${escapeHtml({ value: row.period })}"${hiddenUnlessActive({ period: row.period, initialPeriod })}>
    <th>${escapeHtml({ value: row.period })}</th>
    <td>${formatCoverage({ runCount: row.runCount, expectedRunCount: row.expectedRunCount })}</td>
    <td>${row.assetCount.toLocaleString()}</td>
    <td>${row.nEngagements.toLocaleString()}</td>
    <td class="${winRateCellClass({ value: row.winRate })}">${formatPercentOrDash({ value: row.winRate })}</td>
    <td>${row.nBarsMax.toLocaleString()}</td>
    <td>${formatDateTimeOrDash({ ms: row.computedAtMaxMs })}</td>
    <td>${formatDateOrDash({ ms: row.rangeFirstMs })} to ${formatDateOrDash({ ms: row.rangeLastMs })}</td>
  </tr>`;
}

function renderAssetTable({
  rows,
  initialPeriod,
}: {
  readonly rows: readonly BacktestDashboardAssetRow[];
  readonly initialPeriod: string;
}): string {
  return `<section class="alea-panel backtest-panel">
    <div class="alea-section-rule"><h2>Assets</h2></div>
    <div class="alea-table-wrap">
      <table class="alea-table backtest-table">
        <thead>
          <tr>
            <th>Period / Asset</th>
            <th>Coverage</th>
            <th>Engagements</th>
            <th>WR</th>
            <th>Bars</th>
            <th>Latest</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => renderAssetRow({ row, initialPeriod })).join("")}
        </tbody>
      </table>
    </div>
  </section>`;
}

function renderAssetRow({
  row,
  initialPeriod,
}: {
  readonly row: BacktestDashboardAssetRow;
  readonly initialPeriod: string;
}): string {
  return `<tr data-backtest-period="${escapeHtml({ value: row.period })}"${hiddenUnlessActive({ period: row.period, initialPeriod })}>
    <th>${escapeHtml({ value: `${row.period} / ${row.asset}` })}</th>
    <td>${formatCoverage({ runCount: row.runCount, expectedRunCount: row.expectedRunCount })}</td>
    <td>${row.nEngagements.toLocaleString()}</td>
    <td class="${winRateCellClass({ value: row.winRate })}">${formatPercentOrDash({ value: row.winRate })}</td>
    <td>${row.nBarsMax.toLocaleString()}</td>
    <td>${formatDateTimeOrDash({ ms: row.computedAtMaxMs })}</td>
  </tr>`;
}

function renderTopCandidateTable({
  rows,
  initialPeriod,
}: {
  readonly rows: readonly BacktestDashboardCandidateRow[];
  readonly initialPeriod: string;
}): string {
  const body =
    rows.length === 0
      ? `<tr><td colspan="9"><span class="alea-muted">No active-profile backtest rows.</span></td></tr>`
      : rows
          .map((row) => renderTopCandidateRow({ row, initialPeriod }))
          .join("");
  const emptyRow =
    rows.length === 0
      ? ""
      : `<tr id="backtest-candidate-empty"${
          rows.some((row) => row.period === initialPeriod) ? " hidden" : ""
        }><td colspan="9"><span class="alea-muted">No active-profile backtest rows for this period.</span></td></tr>`;
  return `<section class="alea-panel backtest-panel">
    <div class="alea-section-rule"><h2>Top Candidates</h2></div>
    <div class="alea-table-wrap">
      <table class="alea-table backtest-table backtest-candidates-table">
        <thead>
          <tr>
            <th>Candidate</th>
            <th>Period</th>
            <th>Family</th>
            <th>Assets</th>
            <th>Engagements</th>
            <th>WR</th>
            <th>UP WR</th>
            <th>DOWN WR</th>
            <th>Config</th>
          </tr>
        </thead>
        <tbody id="backtest-candidate-body">${body}${emptyRow}</tbody>
      </table>
    </div>
  </section>`;
}

function renderTopCandidateRow({
  row,
  initialPeriod,
}: {
  readonly row: BacktestDashboardCandidateRow;
  readonly initialPeriod: string;
}): string {
  const family =
    row.filterFamily === null
      ? "unknown"
      : familyLabel({ family: row.filterFamily as FilterFamily });
  return `<tr data-backtest-period="${escapeHtml({ value: row.period })}"${hiddenUnlessActive({ period: row.period, initialPeriod })}>
    <th>
      <span class="backtest-filter-id">${escapeHtml({ value: row.filterId })}</span>
      <span class="backtest-filter-version">v${row.filterVersion.toLocaleString()}</span>
    </th>
    <td>${escapeHtml({ value: row.period })}</td>
    <td>${escapeHtml({ value: family })}</td>
    <td>${row.assetCount.toLocaleString()}</td>
    <td>${row.nEngagements.toLocaleString()}</td>
    <td class="${winRateCellClass({ value: row.winRate })}">${formatPercentOrDash({ value: row.winRate })}</td>
    <td class="${winRateCellClass({ value: row.upWinRate })}">${formatPercentOrDash({ value: row.upWinRate })}</td>
    <td class="${winRateCellClass({ value: row.downWinRate })}">${formatPercentOrDash({ value: row.downWinRate })}</td>
    <td class="backtest-config">${escapeHtml({ value: row.configCanon })}</td>
  </tr>`;
}

function profileItem({
  id,
  label,
  value,
}: {
  readonly id?: string;
  readonly label: string;
  readonly value: string;
}): string {
  const idAttr = id === undefined ? "" : ` id="${id}"`;
  return `<div class="backtest-profile-item">
    <span class="backtest-profile-label">${escapeHtml({ value: label })}</span>
    <span${idAttr} class="backtest-profile-value">${escapeHtml({ value })}</span>
  </div>`;
}

function hiddenUnlessActive({
  period,
  initialPeriod,
}: {
  readonly period: string;
  readonly initialPeriod: string;
}): string {
  return period === initialPeriod ? "" : " hidden";
}

function formatCoverage({
  runCount,
  expectedRunCount,
}: {
  readonly runCount: number;
  readonly expectedRunCount: number;
}): string {
  if (expectedRunCount === 0) {
    return "0 / 0";
  }
  return `${runCount.toLocaleString()} / ${expectedRunCount.toLocaleString()}`;
}

function formatPercentOrDash({
  value,
}: {
  readonly value: number | null;
}): string {
  return value === null ? "—" : formatPercent({ value });
}

function formatDateTimeOrDash({ ms }: { readonly ms: number | null }): string {
  return ms === null ? "—" : formatDateTime({ ms });
}

function formatDateOrDash({ ms }: { readonly ms: number | null }): string {
  return ms === null ? "—" : new Date(ms).toISOString().slice(0, 10);
}

function winRateCellClass({
  value,
}: {
  readonly value: number | null;
}): string {
  return `alea-mono${winRateToneClass({ value })}`;
}
