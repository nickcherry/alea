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
  infoTip,
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
        <div class="alea-pill-tabs" role="tablist" aria-label="Asset">
          <button class="alea-pill-tab is-prominent committee-asset-tab" role="tab" data-asset="btc" aria-selected="true">BTC</button>
          <button class="alea-pill-tab is-prominent committee-asset-tab" role="tab" data-asset="eth" aria-selected="false">ETH</button>
          <button class="alea-pill-tab is-prominent committee-asset-tab" role="tab" data-asset="sol" aria-selected="false">SOL</button>
          <button class="alea-pill-tab is-prominent committee-asset-tab" role="tab" data-asset="xrp" aria-selected="false">XRP</button>
          <button class="alea-pill-tab is-prominent committee-asset-tab" role="tab" data-asset="doge" aria-selected="false">DOGE</button>
        </div>
      </div>

      <section class="committee-section">
        <details class="alea-config-section">
          <summary class="alea-config-summary alea-section-rule"><h2>Selection Config</h2></summary>
          <div class="alea-config-grid">
            ${renderConfigGroup({
              title: "Eligibility",
              items: [
                {
                  label: "Min Engagements",
                  value: `>= ${payload.selectionConfig.minEngagements.toLocaleString()}`,
                  tip: "Minimum engagements inside the target regime before a candidate qualifies.",
                },
                {
                  label: "Aggregate WR Floor",
                  value: `>= ${formatPercent({ value: payload.selectionConfig.minAggregateWinRate })}`,
                  tip: "Floor on the candidate's aggregate win rate within the regime.",
                },
                {
                  label: "Worst-Quarter WR Floor",
                  value: `>= ${formatPercent({ value: payload.selectionConfig.minWorstQuarterWinRate })}`,
                  tip: "Floor on the worst quarter's win rate — only quarters above the sample floor are counted.",
                },
                {
                  label: "Worst-Quarter Sample",
                  value: `>= ${payload.selectionConfig.worstQuarterMinEngagements.toLocaleString()}`,
                  tip: "A quarter only counts toward the worst-quarter floor once it has this many engagements.",
                },
              ],
            })}
            ${renderConfigGroup({
              title: "Selection",
              items: [
                {
                  label: "Bucket Cap",
                  value: `<= ${payload.selectionConfig.topN.toLocaleString()}`,
                  tip: "Max candidates selected per asset/timeframe/regime bucket.",
                },
                {
                  label: "Ranking",
                  value: "Wilson low desc",
                  tip: "Sorted by Wilson lower bound (descending). Ties broken by engagement count (descending).",
                },
              ],
            })}
            ${renderConfigGroup({
              title: "Training",
              items: [
                {
                  label: "Training Window",
                  value: `${formatTrainingStartPolicy({
                    value: payload.selectionConfig.trainingWindowStartPolicy,
                  })} -> ${formatUtcDate({
                    ms: payload.selectionConfig.trainingWindowEndInclusiveMs,
                  })}`,
                  tip: "Date range used for training, UTC. End date is inclusive.",
                },
                {
                  label: "Training Move Floor",
                  value: `${payload.selectionConfig.trainingOutcomeMinAbsMovePct.toLocaleString()}%`,
                  tip: "Minimum open-to-close absolute move (%) required for a candle to count as an outcome.",
                },
                {
                  label: "Training Profile",
                  value: payload.selectionConfig.trainingProfileId,
                  tip: "Identifier combining the outcome rule and research windows.",
                },
              ],
            })}
          </div>
        </details>
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

function formatTrainingStartPolicy({
  value,
}: {
  readonly value: "earliest_available_candle";
}): string {
  switch (value) {
    case "earliest_available_candle":
      return "earliest candle";
  }
}

function formatUtcDate({ ms }: { readonly ms: number }): string {
  return new Date(ms).toISOString().slice(0, 10);
}

type ConfigItem = {
  readonly label: string;
  readonly value: string;
  readonly tip: string;
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
  const tipHtml = item.tip === "" ? "" : infoTip({ text: item.tip });
  return `
    <div class="alea-config-item">
      <span class="alea-config-label">${escapeHtml({ value: item.label })}${tipHtml}</span>
      <span class="alea-config-value">${escapeHtml({ value: item.value })}</span>
    </div>`;
}
