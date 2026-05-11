import type {
  TradeCommitteeCandidateRow,
  TradeCommitteePayload,
} from "@alea/lib/committee/dashboard/types";
import type { FilterFamily } from "@alea/lib/filters/types";
import {
  aleaBrandMark,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import { renderTopNav } from "@alea/lib/ui/topNav";

const DEFAULT_PERIOD = "5m";

export function renderTradeCommitteeHtml({
  payload,
  assets,
}: {
  readonly payload: TradeCommitteePayload;
  readonly assets: {
    readonly stylesheets: readonly string[];
    readonly scripts: readonly string[];
  };
}): string {
  const subtitle = [
    `generated ${formatDateTime({ ms: payload.generatedAtMs })}`,
    `${payload.rowCount.toLocaleString()} committee candidates`,
  ].join('<span class="sep">&middot;</span>');
  const payloadJson = escapeJsonForHtml({ value: JSON.stringify(payload) });
  const defaultRows = payload.rows.filter((r) => r.period === DEFAULT_PERIOD);

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alea &middot; Trade Committee</title>
  ${aleaDesignSystemHead({ stylesheets: assets.stylesheets })}
</head>
<body>
  <div class="alea-shell">
    <header class="alea-header">
      <div class="alea-brand-row">${aleaBrandMark()}</div>
      <h1 class="alea-title">Trade Committee</h1>
      <p class="alea-subtitle">${subtitle}</p>
    </header>
    ${renderTopNav({ activeId: "committee" })}
    <main class="alea-main">
      <section class="alea-summary-grid cols-4">
        ${renderMetric({
          label: "Candidates",
          value: payload.rowCount.toLocaleString(),
          sub: `${payload.uniqueFilterCount.toLocaleString()} unique filters`,
          tip: TIPS.candidates,
        })}
        ${renderMetric({
          label: "Active Buckets",
          value: `${payload.activeBucketCount}/8`,
          sub: "period x regime rosters",
          tip: TIPS.activeBuckets,
        })}
        ${renderMetric({
          label: "Selected At",
          value:
            payload.selectedAtMs === null
              ? "&mdash;"
              : formatShortDateTime({ ms: payload.selectedAtMs }),
          sub: "latest roster snapshot",
          tip: TIPS.selectedAt,
        })}
        ${renderMetric({
          label: "Bucket Cap",
          value: payload.selectionConfig.topN.toLocaleString(),
          sub: "max candidates per period/regime",
          tip: TIPS.bucketCap,
        })}
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Selection Config</h2></div>
        <div class="committee-config-grid">
          ${renderConfigItem({
            label: "Min Engagements",
            value: `>= ${payload.selectionConfig.minEngagements.toLocaleString()}`,
            sub: "inside the target regime",
          })}
          ${renderConfigItem({
            label: "Aggregate WR Floor",
            value: `>= ${formatPercent({ value: payload.selectionConfig.minAggregateWinRate })}`,
            sub: "candidate/regime aggregate",
          })}
          ${renderConfigItem({
            label: "Worst-Quarter WR Floor",
            value: `>= ${formatPercent({ value: payload.selectionConfig.minWorstQuarterWinRate })}`,
            sub: "only quarters above sample floor",
          })}
          ${renderConfigItem({
            label: "Worst-Quarter Sample",
            value: `>= ${payload.selectionConfig.worstQuarterMinEngagements.toLocaleString()}`,
            sub: "engagements before quarter counts",
          })}
          ${renderConfigItem({
            label: "Ranking",
            value: "Wilson low desc",
            sub: "ties: engagements desc",
          })}
          ${renderConfigItem({
            label: "Training Move Floor",
            value: `${payload.selectionConfig.trainingOutcomeMinAbsMovePct.toLocaleString()}%`,
            sub: "open-to-close absolute move",
          })}
          <div class="committee-config-item committee-config-wide">
            <span class="committee-config-label">Training Profile</span>
            <span class="committee-config-value alea-mono">${escapeHtml({
              value: payload.selectionConfig.trainingOutcomeProfileId,
            })}</span>
          </div>
        </div>
      </section>

      <section class="committee-roster-card">
        <header class="committee-roster-header">
          <div>
            <div class="alea-section-rule"><h2>Roster</h2></div>
            <p id="committee-roster-meta" class="committee-roster-meta">${renderRosterMeta(
              {
                rows: defaultRows,
                period: DEFAULT_PERIOD,
                regime: "all",
              },
            )}</p>
          </div>
          <div class="committee-controls" aria-label="Roster filters">
            <div class="committee-period-tabs" role="tablist" aria-label="Candle period">
              <button class="committee-period-tab" role="tab" data-period="5m" aria-selected="true">5m</button>
              <button class="committee-period-tab" role="tab" data-period="15m" aria-selected="false">15min</button>
            </div>
            <div class="committee-regime-tabs" role="tablist" aria-label="Market regime">
              <button class="committee-regime-tab" role="tab" data-regime="all" aria-selected="true">All</button>
              <button class="committee-regime-tab" role="tab" data-regime="low_vol_ranging" aria-selected="false">Low vol ranging</button>
              <button class="committee-regime-tab" role="tab" data-regime="low_vol_trending" aria-selected="false">Low vol trending</button>
              <button class="committee-regime-tab" role="tab" data-regime="high_vol_ranging" aria-selected="false">High vol ranging</button>
              <button class="committee-regime-tab" role="tab" data-regime="high_vol_trending" aria-selected="false">High vol trending</button>
            </div>
          </div>
        </header>
        <div class="committee-table-wrap">
          <table class="committee-table">
            <colgroup>
              <col style="width: 7%" />
              <col style="width: 14%" />
              <col style="width: 21%" />
              <col style="width: 23%" />
              <col style="width: 9%" />
              <col style="width: 10%" />
              <col style="width: 8%" />
              <col style="width: 8%" />
            </colgroup>
            <thead>
              <tr>
                <th class="num-col">Rank${infoTip({ text: TIPS.rank })}</th>
                <th>Regime${infoTip({ text: TIPS.regime })}</th>
                <th>Filter${infoTip({ text: TIPS.filter })}</th>
                <th>Config${infoTip({ text: TIPS.config })}</th>
                <th class="num-col">Engagements${infoTip({ text: TIPS.engagements })}</th>
                <th class="num-col">Win Rate${infoTip({ text: TIPS.winRate })}</th>
                <th class="num-col">Wilson Low${infoTip({ text: TIPS.wilson })}</th>
                <th class="num-col">Worst Q WR${infoTip({ text: TIPS.worstQuarter })}</th>
              </tr>
            </thead>
            <tbody id="committee-rows">
              ${renderRows({ rows: defaultRows })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </div>
  <script id="trade-committee-payload" type="application/json">${payloadJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>`;
}

function renderMetric({
  label,
  value,
  sub,
  tip,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly tip: string;
}): string {
  return `
    <div class="alea-metric">
      <div class="alea-metric-label">${escapeHtml({ value: label })}${infoTip({ text: tip })}</div>
      <div class="alea-metric-value">${value}</div>
      <div class="alea-metric-sub">${escapeHtml({ value: sub })}</div>
    </div>`;
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
    <div class="committee-config-item">
      <span class="committee-config-label">${escapeHtml({ value: label })}</span>
      <span class="committee-config-value">${escapeHtml({ value })}</span>
      <span class="committee-config-sub">${escapeHtml({ value: sub })}</span>
    </div>`;
}

function renderRows({
  rows,
}: {
  readonly rows: readonly TradeCommitteeCandidateRow[];
}): string {
  if (rows.length === 0) {
    return `<tr><td colspan="8"><span class="alea-muted">No candidates in this scope.</span></td></tr>`;
  }
  return rows.map((row) => renderRow({ row })).join("");
}

function renderRow({
  row,
}: {
  readonly row: TradeCommitteeCandidateRow;
}): string {
  const family =
    row.filterFamily === null
      ? "unregistered"
      : familyLabel({ family: row.filterFamily });
  const worst =
    row.worstQuarterWinRate === null
      ? '<span class="alea-muted">&mdash;</span>'
      : `<span class="alea-mono${toneClass({ value: row.worstQuarterWinRate })}">${formatPercent(
          {
            value: row.worstQuarterWinRate,
          },
        )}</span>`;
  return `
    <tr>
      <td class="num-col"><span class="committee-rank-pill">#${row.rank.toLocaleString()}</span></td>
      <td><span class="committee-bucket-pill">${escapeHtml({
        value: formatMarketRegime({ value: row.marketRegime }),
      })}</span></td>
      <td>
        <div class="committee-filter-cell">
          <span class="committee-filter-id alea-mono">${escapeHtml({ value: row.filterId })}</span>
          <span class="committee-filter-family">${escapeHtml({ value: family })}</span>
        </div>
      </td>
      <td><span class="alea-mono committee-config-text" title="${escapeHtml({
        value: row.configCanon,
      })}">${escapeHtml({ value: row.configCanon })}</span></td>
      <td class="num-col alea-mono">${row.nEngagements.toLocaleString()}</td>
      <td class="num-col">${renderWinRateCell({ row })}</td>
      <td class="num-col alea-mono${toneClass({ value: row.wilsonLow })}">${formatPercent(
        {
          value: row.wilsonLow,
        },
      )}</td>
      <td class="num-col">${worst}</td>
    </tr>`;
}

function renderWinRateCell({
  row,
}: {
  readonly row: TradeCommitteeCandidateRow;
}): string {
  return `
    <div class="committee-wr-cell">
      <span class="committee-wr-value${toneClass({ value: row.winRate })}">${formatPercent(
        {
          value: row.winRate,
        },
      )}</span>
      <span class="committee-wr-sub">${row.nWins.toLocaleString()}/${row.nEngagements.toLocaleString()}</span>
    </div>`;
}

function renderRosterMeta({
  rows,
  period,
  regime,
}: {
  readonly rows: readonly TradeCommitteeCandidateRow[];
  readonly period: string;
  readonly regime: string;
}): string {
  const regimeLabel =
    regime === "all" ? "all regimes" : formatMarketRegime({ value: regime });
  return `Showing ${rows.length.toLocaleString()} ${period} candidates in ${regimeLabel}.`;
}

function familyLabel({ family }: { readonly family: FilterFamily }): string {
  switch (family) {
    case "band_reversion":
      return "band reversion";
    case "oscillator_reversion":
      return "oscillator reversion";
    case "velocity_fade":
      return "velocity fade";
    case "ma_position":
      return "ma position";
    case "pattern":
      return "pattern";
    case "divergence":
      return "divergence";
  }
}

function formatMarketRegime({ value }: { readonly value: string }): string {
  return value.replaceAll("_", " ");
}

function toneClass({ value }: { readonly value: number }): string {
  if (value >= 0.52) {
    return " alea-num-positive";
  }
  if (value < 0.48) {
    return " alea-num-negative";
  }
  return "";
}

function formatPercent({ value }: { readonly value: number }): string {
  return `${(value * 100).toFixed(1)}%`;
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

function formatShortDateTime({ ms }: { readonly ms: number }): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function infoTip({ text }: { readonly text: string }): string {
  return ` <span class="alea-info-tip" tabindex="0" data-tip="${escapeHtml({
    value: text,
  })}" aria-label="${escapeHtml({ value: text })}"></span>`;
}

const TIPS = {
  candidates:
    "Rows currently persisted in committee_selections. Each row is one filter config admitted to one period/regime bucket.",
  activeBuckets:
    "There are eight possible rosters: 5m and 15m across four market regimes.",
  selectedAt:
    "Timestamp written by the latest committee:select run. The dry-run loop only sees this roster after restart.",
  bucketCap:
    "The selector takes at most this many ranked candidates in each period/regime bucket.",
  rank: "One-based rank inside the selected period/regime bucket.",
  regime: "Market state bucket the candidate is allowed to vote in.",
  filter: "Registered filter implementation and strategy family.",
  config: "Exact parameter values for this selected filter candidate.",
  engagements:
    "Backtest predictions inside this regime. This is the sample that qualified the candidate.",
  winRate: "Wins divided by engagements inside this regime at selection time.",
  wilson:
    "Wilson 95 percent lower bound used for ranking after eligibility gates pass.",
  worstQuarter:
    "Lowest quarter win rate among quarters with enough engagements to count.",
};
