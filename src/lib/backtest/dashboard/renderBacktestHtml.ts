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
type BacktestEquityPoint = CommitteeBacktestSummary["equityCurve"][number];

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
  ${renderPnlChart(run)}
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
  const scoredNotionalUsd = totals.scoredTrades * run.stakeUsd;
  return `<section class="alea-panel backtest-panel backtest-summary-panel">
    <div class="alea-section-rule"><h2>Latest Run</h2></div>
    <div class="backtest-summary-grid">
      ${summaryGroup({
        title: "Replay",
        items: [
          { label: "Run", value: run.id },
          {
            label: "Completed",
            value: formatDateTime({ ms: run.completedAtMs }),
          },
          {
            label: "Window",
            value: `${formatUtcDate(run.windowStartMs)} to ${formatUtcDate(run.windowEndExclusiveMs - 1)}`,
          },
          { label: "Runtime", value: `${run.durationMs.toLocaleString()} ms` },
        ],
      })}
      ${summaryGroup({
        title: "Activity",
        items: [
          {
            label: "Moments",
            value: totals.decisionMoments.toLocaleString(),
          },
          {
            label: "Committee decisions",
            value: totals.committeeDecisions.toLocaleString(),
          },
          {
            label: "Scored trades",
            value: totals.scoredTrades.toLocaleString(),
          },
          {
            label: "Ambiguous",
            value: totals.ambiguousTrades.toLocaleString(),
          },
        ],
      })}
      ${summaryGroup({
        title: "Economics",
        items: [
          { label: "Notional order size", value: formatUsd(run.stakeUsd) },
          { label: "Scored notional", value: formatUsd(scoredNotionalUsd) },
          { label: "Win rate", value: formatPercentOrDash(totals.winRate) },
          {
            label: "Net wins",
            value: formatSignedInteger(totals.wins - totals.losses),
          },
          { label: "PnL proxy", value: formatUsd(totals.pnlUsd) },
          {
            label: "ROI proxy",
            value:
              scoredNotionalUsd === 0
                ? "-"
                : formatPercent({ value: totals.pnlUsd / scoredNotionalUsd }),
          },
        ],
      })}
    </div>
  </section>`;
}

function renderPnlChart(run: CommitteeBacktestSummary): string {
  const points = run.equityCurve ?? [];
  const finalPoint = points.at(-1);
  const peakPnlUsd =
    points.length === 0
      ? 0
      : Math.max(...points.map((point) => point.cumulativePnlUsd));
  const troughPnlUsd =
    points.length === 0
      ? 0
      : Math.min(...points.map((point) => point.cumulativePnlUsd));
  return `<section class="alea-panel backtest-panel backtest-pnl-panel">
    <div class="alea-section-rule"><h2>PnL Over Time</h2></div>
    <div class="backtest-chart-summary">
      ${profileItem({ label: "Final", value: formatUsd(finalPoint?.cumulativePnlUsd ?? 0) })}
      ${profileItem({ label: "Peak", value: formatUsd(peakPnlUsd) })}
      ${profileItem({ label: "Trough", value: formatUsd(troughPnlUsd) })}
      ${profileItem({ label: "Days", value: points.length.toLocaleString() })}
    </div>
    <div class="backtest-chart-frame">
      ${
        points.length === 0
          ? `<div class="backtest-chart-empty">No PnL curve for this run.</div>`
          : renderEquityCurveSvg({ points })
      }
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
      ${profileItem({ label: "Decision lead", value: formatLeadTimes({ periods: run.periods, leadTimeByPeriodMs: run.tradeDecisionConfig.leadTimeByPeriodMs }) })}
      ${profileItem({ label: "Allowed regimes", value: formatRegimes({ values: run.tradeDecisionConfig.allowedMarketRegimes }) })}
      ${profileItem({ label: "Min votes", value: run.tradeDecisionConfig.minVotesToTrade.toLocaleString() })}
      ${profileItem({ label: "Min consensus", value: formatPercent({ value: run.tradeDecisionConfig.minConsensusFraction }) })}
    </div>
  </details>`;
}

function formatLeadTimes({
  periods,
  leadTimeByPeriodMs,
}: {
  readonly periods: readonly string[];
  readonly leadTimeByPeriodMs?: { readonly [period: string]: number };
}): string {
  return periods
    .map((period) => {
      const leadMs = leadTimeByPeriodMs?.[period];
      if (leadMs === undefined) {
        return `${period}: n/a`;
      }
      const minutes = leadMs / 60_000;
      return `${period}: ${minutes.toLocaleString()}m`;
    })
    .join(" / ");
}

function formatRegimes({
  values,
}: {
  readonly values: readonly string[];
}): string {
  return values.map((value) => value.replaceAll("_", " ")).join(", ");
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

function summaryGroup({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly { readonly label: string; readonly value: string }[];
}): string {
  return `<section class="backtest-summary-group" aria-label="${escapeHtml({ value: title })}">
    <h3>${escapeHtml({ value: title })}</h3>
    <div class="backtest-profile-grid backtest-summary-items">
      ${items.map(profileItem).join("")}
    </div>
  </section>`;
}

function renderEquityCurveSvg({
  points,
}: {
  readonly points: readonly BacktestEquityPoint[];
}): string {
  const width = 920;
  const height = 300;
  const margin = { top: 18, right: 18, bottom: 34, left: 68 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const values = points.map((point) => point.cumulativePnlUsd);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const span = rawMax - rawMin;
  const pad = span === 0 ? 1 : Math.max(1, span * 0.08);
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;
  const firstMs = points[0]!.timestampMs;
  const lastMs = points.at(-1)!.timestampMs;
  const xSpan = Math.max(1, lastMs - firstMs);
  const xFor = (ms: number) =>
    margin.left + ((ms - firstMs) / xSpan) * chartWidth;
  const yFor = (value: number) =>
    margin.top + ((yMax - value) / (yMax - yMin)) * chartHeight;
  const coords = points.map((point) => ({
    x: xFor(point.timestampMs),
    y: yFor(point.cumulativePnlUsd),
  }));
  const linePath = coords
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(" ");
  const zeroY = yFor(0);
  const first = coords[0]!;
  const last = coords.at(-1)!;
  const areaPath = `${linePath} L ${last.x.toFixed(2)} ${zeroY.toFixed(2)} L ${first.x.toFixed(2)} ${zeroY.toFixed(2)} Z`;
  const yTicks = buildTicks({ min: yMin, max: yMax, count: 5 });
  const xTicks = pickDateTicks({ points, count: 5 });
  const positive = values.at(-1)! >= 0;

  return `<svg class="backtest-equity-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative PnL proxy over time">
    <g class="backtest-chart-grid">
      ${yTicks
        .map((tick) => {
          const y = yFor(tick);
          return `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}"></line>
      <text x="${margin.left - 10}" y="${(y + 4).toFixed(2)}" text-anchor="end">${escapeHtml({ value: formatCompactUsd(tick) })}</text>`;
        })
        .join("\n      ")}
    </g>
    <line class="backtest-chart-zero" x1="${margin.left}" x2="${width - margin.right}" y1="${zeroY.toFixed(2)}" y2="${zeroY.toFixed(2)}"></line>
    <path class="backtest-equity-area ${positive ? "is-positive" : "is-negative"}" d="${areaPath}"></path>
    <path class="backtest-equity-line ${positive ? "is-positive" : "is-negative"}" d="${linePath}"></path>
    <g class="backtest-chart-x">
      ${xTicks
        .map((point) => {
          const x = xFor(point.timestampMs);
          return `<text x="${x.toFixed(2)}" y="${height - 8}" text-anchor="middle">${escapeHtml({ value: formatAxisDate(point.timestampMs) })}</text>`;
        })
        .join("\n      ")}
    </g>
  </svg>`;
}

function buildTicks({
  min,
  max,
  count,
}: {
  readonly min: number;
  readonly max: number;
  readonly count: number;
}): readonly number[] {
  if (count <= 1) {
    return [min];
  }
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

function pickDateTicks({
  points,
  count,
}: {
  readonly points: readonly BacktestEquityPoint[];
  readonly count: number;
}): readonly BacktestEquityPoint[] {
  if (points.length <= count) {
    return points;
  }
  const lastIndex = points.length - 1;
  const indexes = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    indexes.add(Math.round((lastIndex * i) / (count - 1)));
  }
  return [...indexes].sort((a, b) => a - b).map((index) => points[index]!);
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

function formatCompactUsd(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}

function formatSignedInteger(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
}

function formatAxisDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });
}
