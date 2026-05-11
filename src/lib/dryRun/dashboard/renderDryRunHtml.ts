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
        <div class="alea-section-rule"><h2>Trade Decision Config</h2></div>
        <div class="alea-config-grid">
          ${renderConfigGroup({
            title: "Timing",
            items: [
              {
                label: "Decision Lead",
                value: `${(payload.decisionConfig.leadTimeMs / 1000).toLocaleString()}s`,
                sub: "before target candle open",
              },
              {
                label: "Hydrated Bars",
                value: payload.decisionConfig.hydratedBars.toLocaleString(),
                sub: "startup history per asset",
              },
            ],
          })}
          ${renderConfigGroup({
            title: "Voting",
            items: [
              {
                label: "Max Votes / Filter",
                value: `<= ${payload.decisionConfig.maxVotesPerFilter.toLocaleString()}`,
                sub: "highest-WR engaged config wins",
              },
              {
                label: "Min Votes",
                value: `>= ${payload.decisionConfig.minVotesToTrade.toLocaleString()}`,
                sub: "after filter-level collapse",
              },
              {
                label: "Consensus",
                value: `>= ${formatPercent({ value: payload.decisionConfig.minConsensusFraction })}`,
                sub: "ties still abstain",
              },
              {
                label: "Filter Tie Break",
                value: formatFilterTieBreak({
                  value: payload.decisionConfig.filterTieBreak,
                }),
                sub: "when multiple configs engage",
              },
            ],
          })}
        </div>
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
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody id="dry-run-recent-body">
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

type ConfigItem = {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
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
  const subHtml =
    item.sub === ""
      ? ""
      : `<span class="alea-config-sub">${escapeHtml({ value: item.sub })}</span>`;
  return `
    <div class="alea-config-item">
      <span class="alea-config-label">${escapeHtml({ value: item.label })}</span>
      <span class="alea-config-value">${escapeHtml({ value: item.value })}</span>
      ${subHtml}
    </div>`;
}

function formatFilterTieBreak({ value }: { readonly value: string }): string {
  if (value === "highest_win_rate_then_engagements_then_rank") {
    return "win rate > engagements > rank";
  }
  return value;
}

