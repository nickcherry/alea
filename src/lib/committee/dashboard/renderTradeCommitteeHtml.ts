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
          ${renderConfigGroup({
            title: "Eligibility",
            items: [
              {
                label: "Min Engagements",
                value: `>= ${payload.selectionConfig.minEngagements.toLocaleString()}`,
                sub: "inside the target regime",
              },
              {
                label: "Aggregate WR Floor",
                value: `>= ${formatPercent({ value: payload.selectionConfig.minAggregateWinRate })}`,
                sub: "candidate/regime aggregate",
              },
              {
                label: "Worst-Quarter WR Floor",
                value: `>= ${formatPercent({ value: payload.selectionConfig.minWorstQuarterWinRate })}`,
                sub: "only quarters above sample floor",
              },
              {
                label: "Worst-Quarter Sample",
                value: `>= ${payload.selectionConfig.worstQuarterMinEngagements.toLocaleString()}`,
                sub: "engagements before quarter counts",
              },
            ],
          })}
          ${renderConfigGroup({
            title: "Selection",
            items: [
              {
                label: "Bucket Cap",
                value: `<= ${payload.selectionConfig.topN.toLocaleString()}`,
                sub: "selected per timeframe/regime",
              },
              {
                label: "Ranking",
                value: "Wilson low desc",
                sub: "ties: engagements desc",
              },
            ],
          })}
          ${renderConfigGroup({
            title: "Training",
            items: [
              {
                label: "Training Move Floor",
                value: `${payload.selectionConfig.trainingOutcomeMinAbsMovePct.toLocaleString()}%`,
                sub: "open-to-close absolute move",
              },
              {
                label: "Training Profile",
                value: payload.selectionConfig.trainingOutcomeProfileId,
                sub: "",
              },
            ],
          })}
        </div>
      </section>

      <section class="committee-section committee-roster-card">
        <header class="committee-roster-header">
          <div>
            <div class="alea-section-rule"><h2>Roster</h2></div>
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


