import type {
  TradeCommitteeBucketSummary,
  TradeCommitteePayload,
} from "@alea/lib/committee/dashboard/types";
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
  infoTip,
  winRateToneClass,
} from "@alea/lib/ui/aleaFormat";
import { renderTopNav } from "@alea/lib/ui/topNav";

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
  const subtitle = `generated ${formatDateTime({ ms: payload.generatedAtMs })}`;
  const payloadJson = escapeJsonForHtml({ value: JSON.stringify(payload) });

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
      <div class="committee-period-row">
        <div class="alea-pill-tabs" role="tablist" aria-label="Candle period">
          <button class="alea-pill-tab is-prominent committee-period-tab" role="tab" data-period="5m" aria-selected="true">5m</button>
          <button class="alea-pill-tab is-prominent committee-period-tab" role="tab" data-period="15m" aria-selected="false">15m</button>
        </div>
      </div>

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
            label: "Bucket Cap",
            value: `<= ${payload.selectionConfig.topN.toLocaleString()}`,
            sub: "selected per timeframe/regime",
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

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Buckets</h2></div>
        <div class="committee-buckets-grid" role="list">
          ${renderBuckets({ payload })}
        </div>
      </section>

      <section class="alea-panel committee-roster-card">
        <header class="committee-roster-header">
          <div>
            <div class="alea-section-rule"><h2>Roster</h2></div>
            <p id="committee-roster-meta" class="committee-roster-meta"></p>
          </div>
          <div class="committee-controls" aria-label="Roster filters">
            <div class="alea-pill-tabs" role="tablist" aria-label="Market regime">
              <button class="alea-pill-tab committee-regime-tab" role="tab" data-regime="low_vol_ranging" aria-selected="true">Low vol ranging</button>
              <button class="alea-pill-tab committee-regime-tab" role="tab" data-regime="low_vol_trending" aria-selected="false">Low vol trending</button>
              <button class="alea-pill-tab committee-regime-tab" role="tab" data-regime="high_vol_ranging" aria-selected="false">High vol ranging</button>
              <button class="alea-pill-tab committee-regime-tab" role="tab" data-regime="high_vol_trending" aria-selected="false">High vol trending</button>
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
            <tbody id="committee-rows" aria-live="polite"></tbody>
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

/**
 * Render the 8-bucket overview tile grid. Buckets come from the loader
 * already ordered by `(period, regime)` so the grid reads top-to-bottom
 * as 5m row then 15m row when the CSS forces 4 columns.
 */
function renderBuckets({
  payload,
}: {
  readonly payload: TradeCommitteePayload;
}): string {
  return payload.buckets
    .map((b) => renderBucketTile({ bucket: b, cap: payload.selectionConfig.topN }))
    .join("");
}

function renderBucketTile({
  bucket,
  cap,
}: {
  readonly bucket: TradeCommitteeBucketSummary;
  readonly cap: number;
}): string {
  const wrLabel =
    bucket.topWinRate === null
      ? "—"
      : formatPercent({ value: bucket.topWinRate });
  const wrCls = winRateToneClass({ value: bucket.topWinRate });
  const filterLabel = bucket.topFilterId ?? "—";
  const isEmpty = bucket.candidateCount === 0;
  const hidden = bucket.period === "5m" ? "" : ' hidden="hidden"';
  return `
    <div class="committee-bucket-tile${isEmpty ? " is-empty" : ""}" role="listitem" data-period="${bucket.period}"${hidden}>
      <div class="committee-bucket-head">
        <span class="committee-bucket-regime">${escapeHtml({ value: formatMarketRegime({ value: bucket.marketRegime }) })}</span>
      </div>
      <div class="committee-bucket-stat">
        <span class="committee-bucket-wr${wrCls}">${wrLabel}</span>
        <span class="committee-bucket-fill">${bucket.candidateCount.toLocaleString()} / ${cap.toLocaleString()}</span>
      </div>
      <div class="committee-bucket-filter alea-mono" title="${escapeHtml({ value: filterLabel })}">${escapeHtml({ value: filterLabel })}</div>
    </div>`;
}

const TIPS = {
  rank: "Rank within this timeframe and regime. #1 is the strongest selected candidate.",
  regime: "Market state where this candidate is allowed to vote.",
  filter: "Signal rule and its strategy family.",
  config: "Exact knob values selected for this filter.",
  engagements: "How many training calls this candidate made in this regime.",
  winRate: "Share of those calls that were correct.",
  wilson:
    "Conservative win-rate estimate used for ranking; rewards high WR with enough sample.",
  worstQuarter: "Lowest quarter win rate among quarters with enough data.",
};
