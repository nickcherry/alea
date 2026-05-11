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
  const summary = payload.summary;
  const wr =
    summary.winRate === null ? "—" : formatPercent({ value: summary.winRate });
  const subtitle = `generated ${formatDateTime({ ms: payload.generatedAtMs })}`;
  const wrToneClass = winRateToneClass({ value: summary.winRate });
  const recentRows = payload.recent.slice(0, RECENT_TABLE_LIMIT);
  const payloadJson = escapeJsonForHtml({ value: JSON.stringify(payload) });
  const chartTokensJson = escapeJsonForHtml({
    value: JSON.stringify(aleaChartTokens),
  });

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
      <section class="alea-summary-grid cols-4">
        ${renderMetric({
          label: "Win Rate",
          value: wr,
          sub: `${summary.totalWins.toLocaleString()} of ${summary.settledDecisions.toLocaleString()} settled · ${summary.upDecisions.toLocaleString()}↑ / ${summary.downDecisions.toLocaleString()}↓`,
          toneClass: wrToneClass,
          tip: DR_TIPS.winRate,
        })}
        ${renderMetric({
          label: "Decisions",
          value: summary.totalDecisions.toLocaleString(),
          sub: `${summary.pendingDecisions.toLocaleString()} pending settlement`,
          tip: DR_TIPS.decisions,
        })}
        ${renderMetric({
          label: "Committee Candidates",
          value: summary.candidateCount.toLocaleString(),
          sub: "registered (filter, config) entries",
          tip: DR_TIPS.candidates,
        })}
        ${renderMetric({
          label: "Avg Engagement / Trade",
          value:
            summary.avgEngagement === null
              ? "—"
              : summary.avgEngagement.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                }),
          sub: "filter-collapsed votes per actionable decision",
          tip: DR_TIPS.avgEngagement,
        })}
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Trade Decision Config</h2></div>
        <div class="dry-run-config-grid">
          ${renderConfigItem({
            label: "Period",
            value: payload.decisionConfig.period,
            sub: "committee roster bucket",
          })}
          ${renderConfigItem({
            label: "Decision Lead",
            value: `${(payload.decisionConfig.leadTimeMs / 1000).toLocaleString()}s`,
            sub: "before target candle open",
          })}
          ${renderConfigItem({
            label: "Hydrated Bars",
            value: payload.decisionConfig.hydratedBars.toLocaleString(),
            sub: "startup history per asset",
          })}
          ${renderConfigItem({
            label: "Max Votes / Filter",
            value: `<= ${payload.decisionConfig.maxVotesPerFilter.toLocaleString()}`,
            sub: "highest-WR engaged config wins",
          })}
          ${renderConfigItem({
            label: "Min Votes",
            value: `>= ${payload.decisionConfig.minVotesToTrade.toLocaleString()}`,
            sub: "after filter-level collapse",
          })}
          ${renderConfigItem({
            label: "Consensus",
            value: `>= ${formatPercent({ value: payload.decisionConfig.minConsensusFraction })}`,
            sub: "ties still abstain",
          })}
          <div class="dry-run-config-wide">
            ${renderConfigItem({
              label: "Filter Tie Break",
              value: formatFilterTieBreak({
                value: payload.decisionConfig.filterTieBreak,
              }),
              sub: "when multiple configs engage",
            })}
          </div>
        </div>
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Cumulative Win Rate</h2></div>
        <div class="dry-run-chart-frame">
          <div id="dry-run-chart" class="dry-run-chart-host"></div>
          <div id="dry-run-chart-empty" class="dry-run-empty"${payload.cumulative.length === 0 ? "" : ' style="display:none"'}>
            No settled decisions yet — the chart will populate as the dry-run loop finalizes bars.
          </div>
          <div id="dry-run-tooltip" class="alea-tooltip"></div>
        </div>
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Per Market Regime</h2></div>
        <div class="alea-table-wrap">
          <table class="alea-table dry-run-table">
            <thead>
              <tr>
                <th>Regime${infoTip({ text: DR_TIPS.regimeName })}</th>
                <th class="num-col">Calls${infoTip({ text: DR_TIPS.callsRegime })}</th>
                <th class="num-col">Win Rate${infoTip({ text: DR_TIPS.callsWr })}</th>
                <th class="num-col">U / D${infoTip({ text: DR_TIPS.directionSplit })}</th>
              </tr>
            </thead>
            <tbody>
              ${
                payload.perRegime.length === 0
                  ? `<tr><td colspan="4"><span class="alea-muted">No regime-tagged decisions yet.</span></td></tr>`
                  : payload.perRegime
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
                      .join("")
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Per Asset</h2></div>
        <div class="alea-table-wrap">
          <table class="alea-table dry-run-table">
            <thead>
              <tr>
                <th>Asset${infoTip({ text: DR_TIPS.recentAsset })}</th>
                <th class="num-col">Calls${infoTip({ text: DR_TIPS.callsAsset })}</th>
                <th class="num-col">Win Rate${infoTip({ text: DR_TIPS.callsWr })}</th>
                <th class="num-col">U / D${infoTip({ text: DR_TIPS.directionSplit })}</th>
              </tr>
            </thead>
            <tbody>
              ${payload.perAsset
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
                </tr>
              `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Recent Decisions</h2></div>
        <p class="dry-run-recent-meta">Showing the latest ${recentRows.length} of ${payload.recent.length.toLocaleString()} decisions (most recent first).</p>
        <div class="alea-table-wrap">
          <table class="alea-table dry-run-recent-table">
            <thead>
              <tr>
                <th>Time${infoTip({ text: DR_TIPS.recentTime })}</th>
                <th>Asset${infoTip({ text: DR_TIPS.recentAsset })}</th>
                <th>Prediction${infoTip({ text: DR_TIPS.recentPrediction })}</th>
                <th>Market Regime${infoTip({ text: DR_TIPS.recentRegime })}</th>
                <th class="num-col">Synth Open${infoTip({ text: DR_TIPS.recentSynthOpen })}</th>
                <th class="num-col">Actual Close${infoTip({ text: DR_TIPS.recentActualClose })}</th>
                <th class="num-col">Move${infoTip({ text: DR_TIPS.recentMove })}</th>
                <th>Outcome${infoTip({ text: DR_TIPS.recentOutcome })}</th>
              </tr>
            </thead>
            <tbody>
              ${recentRows.map(renderRecentRow).join("")}
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
      <td>${outcome}</td>
    </tr>
  `;
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

function renderMetric({
  label,
  value,
  sub,
  toneClass = "",
  tip = "",
}: {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly toneClass?: string;
  readonly tip?: string;
}): string {
  return `
    <div class="alea-metric">
      <p class="alea-metric-label">${escapeHtml({ value: label })}${tip === "" ? "" : infoTip({ text: tip })}</p>
      <p class="alea-metric-value${toneClass}">${escapeHtml({ value })}</p>
      <p class="alea-metric-sub">${escapeHtml({ value: sub })}</p>
    </div>
  `;
}

function renderConfigItem({
  label,
  value,
  sub,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
}): string {
  return `
    <div class="dry-run-config-item">
      <span class="dry-run-config-label">${escapeHtml({ value: label })}</span>
      <span class="dry-run-config-value">${escapeHtml({ value })}</span>
      <span class="dry-run-config-sub">${escapeHtml({ value: sub })}</span>
    </div>`;
}

function formatFilterTieBreak({ value }: { readonly value: string }): string {
  if (value === "highest_win_rate_then_engagements_then_rank") {
    return "win rate > engagements > rank";
  }
  return value;
}

/**
 * Plain-English tooltips for the dry-run dashboard. Surface every
 * table column header and metric label so a non-author landing on
 * the page can read what each number means without spelunking the
 * code.
 */
const DR_TIPS = {
  winRate:
    "Of settled dry-run calls, how often the committee picked the right direction.",
  decisions:
    "All dry-run calls made. Pending calls are waiting for the target bar to close.",
  candidates: "Committee filter configs available to vote.",
  avgEngagement:
    "Average number of filter-collapsed votes on an actionable call.",
  regimeName:
    "Market state at decision time: volatility plus trending/ranging.",
  callsRegime: "Settled calls made in this regime.",
  callsAsset: "Settled calls for this asset.",
  callsWr: "Win rate for this row's settled calls.",
  recentTime: "Opening time of the bar being predicted, in UTC.",
  recentAsset: "Crypto being predicted.",
  recentPrediction: "Committee's UP or DOWN call.",
  recentRegime: "Market state when the call was made.",
  recentSynthOpen: "Price used as the bar open.",
  recentActualClose: "Final price after the bar closed.",
  recentMove:
    "Open-to-close percent move. Positive = up, negative = down. The committee wins when this matches its UP/DOWN call.",
  recentOutcome:
    "WIN if the call matched the actual direction; otherwise LOSS.",
  directionSplit:
    "How the committee's settled calls split between UP (↑) and DOWN (↓) in this slice. A heavy lean hints at a one-way bias.",
};
