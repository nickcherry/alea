import type {
  BacktestDashboardAssetRow,
  BacktestDashboardCandidateRow,
  BacktestDashboardPayload,
  BacktestDashboardPeriodRow,
} from "@alea/lib/backtest/dashboard/types";
import type { FilterFamily } from "@alea/lib/filters/types";
import {
  aleaBrandMark,
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
  const subtitle = [
    `generated ${formatDateTime({ ms: payload.generatedAtMs })}`,
    `latest ${formatDateTimeOrDash({ ms: payload.summary.computedAtMaxMs })}`,
    `${payload.summary.runCount.toLocaleString()} runs`,
  ].join('<span class="sep">&middot;</span>');
  const payloadJson = escapeJsonForHtml({ value: JSON.stringify(payload) });

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
      <p class="alea-subtitle">${subtitle}</p>
    </header>
    ${renderTopNav({ activeId: "backtest" })}
    <main class="alea-main backtest-main">
      ${renderSummary({ payload })}
      ${renderProfile({ payload })}
      ${renderPeriodTable({ rows: payload.byPeriod })}
      ${renderAssetTable({ rows: payload.byAsset })}
      ${renderTopCandidateTable({ rows: payload.topCandidates })}
    </main>
  </div>
  <script id="backtest-payload" type="application/json">${payloadJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>`;
}

function renderSummary({
  payload,
}: {
  readonly payload: BacktestDashboardPayload;
}): string {
  const s = payload.summary;
  return `<section class="alea-summary-grid backtest-summary" aria-label="Backtest summary">
    ${metric({
      label: "Coverage",
      value: formatCoverage({
        runCount: s.runCount,
        expectedRunCount: s.expectedRunCount,
      }),
      sub: `${s.missingRunCount.toLocaleString()} missing`,
      tone: s.missingRunCount === 0 ? "positive" : "negative",
    })}
    ${metric({
      label: "Win rate",
      value: formatPercentOrDash({ value: s.winRate }),
      sub: `${s.nWins.toLocaleString()} / ${s.nEngagements.toLocaleString()}`,
      tone: toneForMetric({ value: s.winRate }),
    })}
    ${metric({
      label: "Latest computed",
      value: formatDateTimeOrDash({ ms: s.computedAtMaxMs }),
      sub: `oldest ${formatDateTimeOrDash({ ms: s.computedAtMinMs })}`,
    })}
    ${metric({
      label: "Candidates",
      value: s.activeCandidateCount.toLocaleString(),
      sub: `${s.activeFilterCount.toLocaleString()} filters`,
    })}
  </section>`;
}

function renderProfile({
  payload,
}: {
  readonly payload: BacktestDashboardPayload;
}): string {
  return `<section class="alea-panel backtest-profile">
    <div class="alea-section-rule"><h2>Profile</h2></div>
    <div class="backtest-profile-grid">
      ${profileItem({ label: "Training profile", value: payload.trainingProfileId })}
      ${profileItem({ label: "Periods", value: payload.supportedPeriods.join(", ") })}
      ${profileItem({ label: "Assets", value: payload.assets.join(", ") })}
      ${profileItem({
        label: "Candle range",
        value: `${formatDateOrDash({ ms: payload.summary.rangeFirstMs })} to ${formatDateOrDash({ ms: payload.summary.rangeLastMs })}`,
      })}
    </div>
  </section>`;
}

function renderPeriodTable({
  rows,
}: {
  readonly rows: readonly BacktestDashboardPeriodRow[];
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
          ${rows.map(renderPeriodRow).join("")}
        </tbody>
      </table>
    </div>
  </section>`;
}

function renderPeriodRow(row: BacktestDashboardPeriodRow): string {
  return `<tr>
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
}: {
  readonly rows: readonly BacktestDashboardAssetRow[];
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
          ${rows.map(renderAssetRow).join("")}
        </tbody>
      </table>
    </div>
  </section>`;
}

function renderAssetRow(row: BacktestDashboardAssetRow): string {
  return `<tr>
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
}: {
  readonly rows: readonly BacktestDashboardCandidateRow[];
}): string {
  const body =
    rows.length === 0
      ? `<tr><td colspan="9"><span class="alea-muted">No active-profile backtest rows.</span></td></tr>`
      : rows.map(renderTopCandidateRow).join("");
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
        <tbody>${body}</tbody>
      </table>
    </div>
  </section>`;
}

function renderTopCandidateRow(row: BacktestDashboardCandidateRow): string {
  const family =
    row.filterFamily === null
      ? "unknown"
      : familyLabel({ family: row.filterFamily as FilterFamily });
  return `<tr>
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

function metric({
  label,
  value,
  sub,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly tone?: "positive" | "negative";
}): string {
  const toneClass = tone === undefined ? "" : ` ${tone}`;
  return `<div class="alea-metric">
    <p class="alea-metric-label">${escapeHtml({ value: label })}</p>
    <p class="alea-metric-value${toneClass}">${escapeHtml({ value })}</p>
    <p class="alea-metric-sub">${escapeHtml({ value: sub })}</p>
  </div>`;
}

function profileItem({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): string {
  return `<div class="backtest-profile-item">
    <span class="backtest-profile-label">${escapeHtml({ value: label })}</span>
    <span class="backtest-profile-value">${escapeHtml({ value })}</span>
  </div>`;
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

function toneForMetric({
  value,
}: {
  readonly value: number | null;
}): "positive" | "negative" | undefined {
  if (value === null) {
    return undefined;
  }
  if (value >= 0.52) {
    return "positive";
  }
  if (value < 0.48) {
    return "negative";
  }
  return undefined;
}
