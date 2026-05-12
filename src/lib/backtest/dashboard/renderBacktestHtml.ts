import type { BacktestDashboardPayload } from "@alea/lib/backtest/dashboard/types";
import type { CommitteeBacktestSummary } from "@alea/lib/backtest/runCommitteeBacktest";
import {
  aleaBrandMark,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import {
  escapeHtml,
  escapeJsonForHtml,
  formatDateTime,
  formatMarketRegime,
  formatPercent,
  winRateToneClass,
} from "@alea/lib/ui/aleaFormat";
import { renderTopNav } from "@alea/lib/ui/topNav";

type BacktestBucket = CommitteeBacktestSummary["byPeriod"][number];

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
      ${payload.latestRun === null ? renderEmptyState() : renderRun(payload.latestRun)}
    </main>
  </div>
  <script id="backtest-payload" type="application/json">${payloadJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>`;
}

function renderEmptyState(): string {
  return `<section class="alea-panel backtest-panel">
    <div class="alea-section-rule"><h2>No Backtest Run</h2></div>
    <p class="alea-muted">Run <span class="alea-mono">bun alea backtest:run</span> to replay the selected trade committee over the holdout window.</p>
  </section>`;
}

function renderRun(
  run: CommitteeBacktestSummary & { readonly id: string },
): string {
  return `${renderSummary(run)}
  ${renderConfig(run)}
  ${renderBucketTable({ title: "By Period", rows: run.byPeriod })}
  ${renderBucketTable({ title: "By Asset", rows: run.byAsset })}
  ${renderBucketTable({
    title: "By Regime",
    rows: run.byRegime.map((row) => ({
      ...row,
      label: formatMarketRegime({ value: row.label }),
    })),
  })}
  ${renderBucketTable({ title: "By Period / Asset", rows: run.byPeriodAsset })}`;
}

function renderSummary(
  run: CommitteeBacktestSummary & { readonly id: string },
): string {
  const totals = run.totals;
  return `<section class="alea-panel backtest-panel">
    <div class="alea-section-rule"><h2>Latest Run</h2></div>
    <div class="backtest-profile-grid">
      ${profileItem({ label: "Run", value: run.id })}
      ${profileItem({ label: "Completed", value: formatDateTime({ ms: run.completedAtMs }) })}
      ${profileItem({ label: "Window", value: `${formatUtcDate(run.windowStartMs)} to ${formatUtcDate(run.windowEndExclusiveMs - 1)}` })}
      ${profileItem({ label: "Committee decisions", value: totals.committeeDecisions.toLocaleString() })}
      ${profileItem({ label: "Scored trades", value: totals.scoredTrades.toLocaleString() })}
      ${profileItem({ label: "Win rate", value: formatPercentOrDash(totals.winRate) })}
      ${profileItem({ label: "PnL proxy", value: formatUsd(totals.pnlUsd) })}
      ${profileItem({ label: "Runtime", value: `${run.durationMs.toLocaleString()} ms` })}
    </div>
  </section>`;
}

function renderConfig(run: CommitteeBacktestSummary): string {
  return `<details class="alea-panel backtest-profile alea-collapsible">
    <summary class="alea-collapsible-summary">
      <h2>Replay Config</h2>
    </summary>
    <div class="backtest-profile-grid">
      ${profileItem({ label: "Run profile", value: run.runProfile })}
      ${profileItem({ label: "Training profile", value: run.trainingProfile })}
      ${profileItem({ label: "Roster selected", value: run.roster.selectedAtMs === null ? "-" : formatDateTime({ ms: run.roster.selectedAtMs }) })}
      ${profileItem({ label: "Roster candidates", value: run.roster.candidateCount.toLocaleString() })}
      ${profileItem({ label: "Periods", value: run.periods.join(", ") })}
      ${profileItem({ label: "Assets", value: run.assets.map((asset) => asset.toUpperCase()).join(", ") })}
      ${profileItem({ label: "Min votes", value: run.tradeDecisionConfig.minVotesToTrade.toLocaleString() })}
      ${profileItem({ label: "Min consensus", value: formatPercent({ value: run.tradeDecisionConfig.minConsensusFraction }) })}
    </div>
  </details>`;
}

function renderBucketTable({
  title,
  rows,
}: {
  readonly title: string;
  readonly rows: readonly BacktestBucket[];
}): string {
  const body =
    rows.length === 0
      ? `<tr><td colspan="10"><span class="alea-muted">No rows.</span></td></tr>`
      : rows.map(renderBucketRow).join("");
  return `<section class="alea-panel backtest-panel">
    <div class="alea-section-rule"><h2>${escapeHtml({ value: title })}</h2></div>
    <div class="alea-table-wrap">
      <table class="alea-table backtest-table backtest-activity-table">
        <thead>
          <tr>
            <th>Scope</th>
            <th>Moments</th>
            <th>Decisions</th>
            <th>Scored</th>
            <th>Wins</th>
            <th>Losses</th>
            <th>Ambig.</th>
            <th>Trade rate</th>
            <th>WR</th>
            <th>PnL</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </section>`;
}

function renderBucketRow(row: BacktestBucket): string {
  return `<tr>
    <th class="backtest-activity-asset">${escapeHtml({ value: row.label })}</th>
    <td class="alea-mono backtest-activity-num">${row.decisionMoments.toLocaleString()}</td>
    <td class="alea-mono backtest-activity-num">${row.committeeDecisions.toLocaleString()}</td>
    <td class="alea-mono backtest-activity-num">${row.scoredTrades.toLocaleString()}</td>
    <td class="alea-mono backtest-activity-num">${row.wins.toLocaleString()}</td>
    <td class="alea-mono backtest-activity-num">${row.losses.toLocaleString()}</td>
    <td class="alea-mono backtest-activity-num">${row.ambiguousTrades.toLocaleString()}</td>
    <td class="alea-mono backtest-activity-num">${formatPercentOrDash(row.tradeRate)}</td>
    <td class="alea-mono${winRateToneClass({ value: row.winRate })} backtest-activity-num">${formatPercentOrDash(row.winRate)}</td>
    <td class="alea-mono backtest-activity-num">${formatUsd(row.pnlUsd)}</td>
  </tr>`;
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

function formatPercentOrDash(value: number | null): string {
  return value === null ? "-" : formatPercent({ value });
}

function formatUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function formatUsd(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;
}
