import type { TradeCommitteePayload } from "@alea/lib/committee/dashboard/types";
import {
  aleaBrandMark,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import {
  escapeHtml,
  escapeJsonForHtml,
  formatDateTime,
  formatPercent,
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
      <div class="alea-page-controls">
        <div class="alea-pill-tabs" role="tablist" aria-label="Candle period">
          <button class="alea-pill-tab is-prominent committee-period-tab" role="tab" data-period="5m" aria-selected="true">5m</button>
          <button class="alea-pill-tab is-prominent committee-period-tab" role="tab" data-period="15m" aria-selected="false">15m</button>
        </div>
      </div>

      <section class="committee-section">
        <div class="alea-section-rule"><h2>Selection Config</h2></div>
        <div class="alea-config-grid">
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
          ${renderConfigItem({
            label: "Training Profile",
            value: payload.selectionConfig.trainingOutcomeProfileId,
            sub: "",
            wide: true,
          })}
        </div>
      </section>

      <section class="committee-section committee-roster-card">
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
                <th class="num-col">Rank</th>
                <th>Regime</th>
                <th>Filter</th>
                <th>Config</th>
                <th class="num-col">Engagements</th>
                <th class="num-col">Win Rate</th>
                <th class="num-col">Wilson Low</th>
                <th class="num-col">Worst Q WR</th>
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
  wide = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly wide?: boolean;
}): string {
  const cls = wide ? "alea-config-item alea-config-wide" : "alea-config-item";
  const subHtml =
    sub === ""
      ? ""
      : `<span class="alea-config-sub">${escapeHtml({ value: sub })}</span>`;
  return `
    <div class="${cls}">
      <span class="alea-config-label">${escapeHtml({ value: label })}</span>
      <span class="alea-config-value">${escapeHtml({ value })}</span>
      ${subHtml}
    </div>`;
}

